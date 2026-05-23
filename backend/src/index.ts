import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { PrismaClient } from '../generated/prisma/client.js'
import { PrismaNeon } from '@prisma/adapter-neon'
import { neon, neonConfig } from '@neondatabase/serverless'
import ws from 'ws'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomBytes, randomUUID } from 'crypto'

const JWT_SECRET = process.env.JWT_SECRET!
if (!JWT_SECRET) throw new Error('JWT_SECRET is required')

// Use WebSocket (port 443) instead of raw TCP (port 5432).
// Required for environments where port 5432 is ISP-blocked.
neonConfig.webSocketConstructor = ws

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const adapter = new PrismaNeon({ connectionString: databaseUrl })
const prisma = new PrismaClient({ adapter })

// HTTP-based raw SQL client (port 443, no WebSocket needed)
const sql = neon(databaseUrl)

async function ensureResetTokenTable() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        token       TEXT UNIQUE NOT NULL,
        expires_at  TIMESTAMPTZ NOT NULL,
        used        BOOLEAN DEFAULT FALSE NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )
    `
    console.log('[DB] password_reset_tokens table ready')
  } catch (err) {
    console.error('[DB] Could not create password_reset_tokens table:', err)
  }
}

// In-memory pub/sub: vehicleNumber -> set of callbacks
type Callback = (data: unknown) => void
const subscribers = new Map<string, Set<Callback>>()

function subscribe(vehicleNumber: string, cb: Callback) {
  if (!subscribers.has(vehicleNumber)) subscribers.set(vehicleNumber, new Set())
  subscribers.get(vehicleNumber)!.add(cb)
}

function unsubscribe(vehicleNumber: string, cb: Callback) {
  subscribers.get(vehicleNumber)?.delete(cb)
}

function publish(vehicleNumber: string, data: unknown) {
  subscribers.get(vehicleNumber)?.forEach(cb => cb(data))
}

const app = new Hono()

app.use('*', cors({ origin: '*' }))

app.get('/', (c) => {
  return c.json({
    ok: true,
    service: 'GPS backend',
    endpoints: [
      'GET /health',
      'GET /api/vehicles',
      'GET /api/vehicle/location?vehicleId=VEHICLE_003&lat=27.4712&lng=89.6399',
      'POST /api/vehicle/location',
      'GET /api/vehicles/:vehicleNumber/latest',
      'GET /api/vehicles/:vehicleNumber/history',
      'GET /api/vehicles/:vehicleNumber/stream',
    ],
  })
})

app.get('/health', (c) => c.json({ ok: true }))

function errorValues(err: unknown): string[] {
  if (!err || typeof err !== 'object') return []
  const error = err as { code?: unknown; message?: unknown; cause?: unknown }
  return [
    error.code,
    error.message,
    ...errorValues(error.cause),
  ].filter((value): value is string => typeof value === 'string')
}

function isRetryableDbError(err: unknown): boolean {
  return errorValues(err).some((value) => {
    const normalized = value.toLowerCase()
    return [
      'etimedout',
      'econnreset',
      'econnrefused',
      'connection terminated',
      'connection timeout',
      'terminating connection',
      'socket closed',
    ].some((retryable) => normalized.includes(retryable))
  })
}

// Retry wrapper for Neon cold-start: compute can take several seconds to wake.
async function dbRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      console.error(`[DB] attempt ${attempt} failed: ${errorValues(err)[0] ?? err}`)
      if (attempt < 3 && isRetryableDbError(err)) {
        await new Promise(r => setTimeout(r, 5000))
        continue
      }
      throw err
    }
  }
  throw new Error('unreachable')
}

// Shared core — used by both GET and POST handlers
async function saveLocation(
  vehicleId: unknown, lat: unknown, lng: unknown,
  speed: unknown, altitude: unknown, satellites: unknown, heading: unknown
): Promise<{ ok: true; locationId: string } | { error: string; status: 400 }> {
  if (!vehicleId || typeof vehicleId !== 'string')
    return { error: 'vehicleId required', status: 400 }
  const latN = Number(lat), lngN = Number(lng)
  if (!Number.isFinite(latN) || !Number.isFinite(lngN))
    return { error: 'lat and lng must be finite numbers', status: 400 }
  if (latN < -90 || latN > 90)   return { error: 'lat out of range [-90, 90]', status: 400 }
  if (lngN < -180 || lngN > 180) return { error: 'lng out of range [-180, 180]', status: 400 }

  const { location } = await dbRetry(() => prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.upsert({
      where: { vehicleNumber: vehicleId as string },
      create: { vehicleNumber: vehicleId as string },
      update: {},
    })

    const location = await tx.location.create({
      data: {
        vehicleId: vehicle.id,
        latitude: latN,
        longitude: lngN,
        speed:    (speed    != null && speed    !== '') ? Number(speed)    : null,
        heading:  (heading  != null && heading  !== '') ? Number(heading)  : null,
      },
    })

    return { location }
  }))

  publish(vehicleId, {
    latitude:   latN,
    longitude:  lngN,
    speed:      (speed     != null && speed     !== '') ? Number(speed)     : null,
    heading:    (heading   != null && heading   !== '') ? Number(heading)   : null,
    altitude:   (altitude  != null && altitude  !== '') ? Number(altitude)  : null,
    satellites: (satellites != null && satellites !== '') ? Number(satellites) : null,
    recordedAt: location.recordedAt.toISOString(),
  })

  return { ok: true, locationId: location.id }
}

// GET /api/vehicle/location?vehicleId=X&lat=Y&lng=Z[&speed=S&altitude=A&satellites=N]
// Used by SIM800C (AT+HTTPDATA is broken on old firmware; GET avoids body entirely)
app.get('/api/vehicle/location', async (c) => {
  const { vehicleId, lat, lng, speed, altitude, satellites, heading } = c.req.query()
  console.log('[GET] query:', { vehicleId, lat, lng, speed })
  const result = await saveLocation(vehicleId, lat, lng, speed, altitude, satellites, heading)
  if ('status' in result) return c.json({ error: result.error }, result.status)
  return c.json(result)
})

// POST /api/vehicle/location  (JSON body)
app.post('/api/vehicle/location', async (c) => {
  const rawBody = await c.req.text()
  console.log('[POST] raw body:', JSON.stringify(rawBody))
  if (!rawBody || rawBody.trim() === '') return c.json({ error: 'Empty body' }, 400)

  let body: Record<string, unknown>
  try { body = JSON.parse(rawBody) }
  catch { return c.json({ error: 'Invalid JSON', received: rawBody }, 400) }

  const { vehicleId, lat, lng, speed, altitude, satellites, heading } = body
  const result = await saveLocation(vehicleId, lat, lng, speed, altitude, satellites, heading)
  if ('status' in result) return c.json({ error: result.error }, result.status)
  return c.json(result)
})

// GET /api/vehicles
app.get('/api/vehicles', async (c) => {
  const vehicles = await prisma.vehicle.findMany({
    include: {
      locations: {
        orderBy: { recordedAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  return c.json(vehicles.map(v => ({
    id: v.id,
    vehicleNumber: v.vehicleNumber,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    latestLocation: v.locations[0]
      ? {
          id: v.locations[0].id,
          latitude: Number(v.locations[0].latitude),
          longitude: Number(v.locations[0].longitude),
          speed: v.locations[0].speed !== null ? Number(v.locations[0].speed) : null,
          heading: v.locations[0].heading !== null ? Number(v.locations[0].heading) : null,
          recordedAt: v.locations[0].recordedAt,
        }
      : null,
  })))
})

// GET /api/vehicles/:vehicleNumber/latest
app.get('/api/vehicles/:vehicleNumber/latest', async (c) => {
  const vehicleNumber = c.req.param('vehicleNumber')
  const location = await prisma.location.findFirst({
    where: { vehicle: { vehicleNumber } },
    orderBy: { recordedAt: 'desc' },
  })

  if (!location) return c.json({ error: 'Not found' }, 404)

  return c.json({
    id: location.id,
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    speed: location.speed !== null ? Number(location.speed) : null,
    heading: location.heading !== null ? Number(location.heading) : null,
    recordedAt: location.recordedAt,
  })
})

// GET /api/vehicles/:vehicleNumber/history?limit=N
app.get('/api/vehicles/:vehicleNumber/history', async (c) => {
  const vehicleNumber = c.req.param('vehicleNumber')
  const limitParam = parseInt(c.req.query('limit') ?? '100', 10)
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? 100 : limitParam), 1000)

  const vehicle = await prisma.vehicle.findUnique({ where: { vehicleNumber } })
  if (!vehicle) return c.json({ error: 'Vehicle not found' }, 404)

  const locations = await prisma.location.findMany({
    where: { vehicleId: vehicle.id },
    orderBy: { recordedAt: 'desc' },
    take: limit,
  })

  return c.json(locations.reverse().map(loc => ({
    id: loc.id,
    latitude: Number(loc.latitude),
    longitude: Number(loc.longitude),
    speed: loc.speed !== null ? Number(loc.speed) : null,
    heading: loc.heading !== null ? Number(loc.heading) : null,
    recordedAt: loc.recordedAt,
  })))
})

// GET /api/vehicles/:vehicleNumber/stream  (SSE)
app.get('/api/vehicles/:vehicleNumber/stream', (c) => {
  const vehicleNumber = c.req.param('vehicleNumber')

  return streamSSE(c, async (stream) => {
    let alive = true

    stream.onAbort(() => { alive = false })

    // Send latest location immediately on connect
    const latest = await prisma.location.findFirst({
      where: { vehicle: { vehicleNumber } },
      orderBy: { recordedAt: 'desc' },
    })

    if (latest && alive) {
      await stream.writeSSE({
        event: 'location',
        data: JSON.stringify({
          latitude: Number(latest.latitude),
          longitude: Number(latest.longitude),
          speed: latest.speed !== null ? Number(latest.speed) : null,
          heading: latest.heading !== null ? Number(latest.heading) : null,
          recordedAt: latest.recordedAt.toISOString(),
        }),
      })
    }

    // Subscribe to published events
    const cb: Callback = (data) => {
      if (!alive) return
      void stream.writeSSE({ event: 'location', data: JSON.stringify(data) })
    }

    subscribe(vehicleNumber, cb)

    try {
      while (alive) {
        await stream.sleep(15000)
        if (!alive) break
        try {
          await stream.writeSSE({ event: 'ping', data: '' })
        } catch {
          alive = false
        }
      }
    } finally {
      unsubscribe(vehicleNumber, cb)
    }
  })
})

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/auth/signup', async (c) => {
  let body: Record<string, unknown>
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const { email, password, name } = body as Record<string, string>
  if (!email || !password) return c.json({ error: 'Email and password required' }, 400)
  if (password.length < 6) return c.json({ error: 'Password must be at least 6 characters' }, 400)

  const normalized = email.toLowerCase().trim()
  const existing = await dbRetry(() => prisma.user.findUnique({ where: { email: normalized } }))
  if (existing) return c.json({ error: 'Email already registered' }, 409)

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await dbRetry(() =>
    prisma.user.create({ data: { email: normalized, name: name?.trim() || null, passwordHash } })
  )

  const token = jwt.sign({ userId: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' })
  return c.json({ ok: true, token, user: { id: user.id, email: user.email, name: user.name } })
})

app.post('/auth/login', async (c) => {
  let body: Record<string, unknown>
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const { email, password } = body as Record<string, string>
  if (!email || !password) return c.json({ error: 'Email and password required' }, 400)

  const normalized = email.toLowerCase().trim()
  const user = await dbRetry(() => prisma.user.findUnique({ where: { email: normalized } }))
  if (!user) return c.json({ error: 'Invalid email or password' }, 401)

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) return c.json({ error: 'Invalid email or password' }, 401)

  const token = jwt.sign({ userId: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' })
  return c.json({ ok: true, token, user: { id: user.id, email: user.email, name: user.name } })
})

app.post('/auth/forgot-password', async (c) => {
  let body: Record<string, unknown>
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const { email } = body as Record<string, string>
  if (!email) return c.json({ error: 'Email required' }, 400)

  const normalized = email.toLowerCase().trim()
  const user = await dbRetry(() => prisma.user.findUnique({ where: { email: normalized } }))

  if (user) {
    // Invalidate any existing unused tokens for this user
    await sql`UPDATE password_reset_tokens SET used = TRUE WHERE user_id = ${user.id} AND used = FALSE`

    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour
    await sql`
      INSERT INTO password_reset_tokens (id, user_id, token, expires_at)
      VALUES (${randomUUID()}, ${user.id}, ${token}, ${expiresAt.toISOString()})
    `

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000'
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`
    console.log(`\n[PASSWORD RESET] Link for ${normalized}:\n  ${resetUrl}\n`)
  }

  // Always the same response — prevents email enumeration
  return c.json({ ok: true })
})

app.post('/auth/reset-password', async (c) => {
  let body: Record<string, unknown>
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const { token, password } = body as Record<string, string>
  if (!token || !password) return c.json({ error: 'Token and password required' }, 400)
  if (password.length < 6) return c.json({ error: 'Password must be at least 6 characters' }, 400)

  const rows = await sql`SELECT * FROM password_reset_tokens WHERE token = ${token} LIMIT 1`
  const record = rows[0] as { id: string; user_id: string; expires_at: string; used: boolean } | undefined

  if (!record) return c.json({ error: 'Invalid or expired reset link' }, 400)
  if (record.used) return c.json({ error: 'This reset link has already been used' }, 400)
  if (new Date(record.expires_at) < new Date()) return c.json({ error: 'Reset link has expired' }, 400)

  const passwordHash = await bcrypt.hash(password, 10)
  await dbRetry(() => prisma.user.update({ where: { id: record.user_id }, data: { passwordHash } }))
  await sql`UPDATE password_reset_tokens SET used = TRUE WHERE id = ${record.id}`

  return c.json({ ok: true, message: 'Password updated successfully' })
})

// ── Server ─────────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? '3001', 10)

serve({ fetch: app.fetch, port }, async (info) => {
  console.log(`GPS backend running on http://localhost:${info.port}`)
  await ensureResetTokenTable()
})
