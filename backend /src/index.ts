import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { PrismaClient } from '../generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

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

// POST /api/vehicle/location
app.post('/api/vehicle/location', async (c) => {
  const body = await c.req.json()
  const { vehicleId, lat, lng, speed, altitude, satellites, heading } = body

  if (!vehicleId || typeof vehicleId !== 'string') {
    return c.json({ error: 'vehicleId required' }, 400)
  }
  if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) {
    return c.json({ error: 'lat and lng must be finite numbers' }, 400)
  }
  if (lat < -90 || lat > 90) return c.json({ error: 'lat out of range [-90, 90]' }, 400)
  if (lng < -180 || lng > 180) return c.json({ error: 'lng out of range [-180, 180]' }, 400)

  const vehicle = await prisma.vehicle.upsert({
    where: { vehicleNumber: vehicleId },
    create: { vehicleNumber: vehicleId },
    update: {},
  })

  const location = await prisma.location.create({
    data: {
      vehicleId: vehicle.id,
      latitude: lat,
      longitude: lng,
      speed: speed !== undefined && speed !== null ? speed : null,
      heading: heading !== undefined && heading !== null ? heading : null,
    },
  })

  const event = {
    latitude: lat,
    longitude: lng,
    speed: speed !== undefined && speed !== null ? Number(speed) : null,
    heading: heading !== undefined && heading !== null ? Number(heading) : null,
    altitude: altitude !== undefined && altitude !== null ? Number(altitude) : null,
    satellites: satellites !== undefined && satellites !== null ? Number(satellites) : null,
    recordedAt: location.recordedAt.toISOString(),
  }

  publish(vehicleId, event)

  return c.json({ ok: true, locationId: location.id })
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

const port = parseInt(process.env.PORT ?? '3001', 10)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`GPS backend running on http://localhost:${info.port}`)
})
