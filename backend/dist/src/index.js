import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const subscribers = new Map();
function subscribe(vehicleNumber, cb) {
    if (!subscribers.has(vehicleNumber))
        subscribers.set(vehicleNumber, new Set());
    subscribers.get(vehicleNumber).add(cb);
}
function unsubscribe(vehicleNumber, cb) {
    subscribers.get(vehicleNumber)?.delete(cb);
}
function publish(vehicleNumber, data) {
    subscribers.get(vehicleNumber)?.forEach(cb => cb(data));
}
const app = new Hono();
app.use('*', cors({ origin: '*' }));
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
    });
});
app.get('/health', (c) => c.json({ ok: true }));
// Shared core — used by both GET and POST handlers
async function saveLocation(vehicleId, lat, lng, speed, altitude, satellites, heading) {
    if (!vehicleId || typeof vehicleId !== 'string')
        return { error: 'vehicleId required', status: 400 };
    const latN = Number(lat), lngN = Number(lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN))
        return { error: 'lat and lng must be finite numbers', status: 400 };
    if (latN < -90 || latN > 90)
        return { error: 'lat out of range [-90, 90]', status: 400 };
    if (lngN < -180 || lngN > 180)
        return { error: 'lng out of range [-180, 180]', status: 400 };
    const vehicle = await prisma.vehicle.upsert({
        where: { vehicleNumber: vehicleId },
        create: { vehicleNumber: vehicleId },
        update: {},
    });
    const location = await prisma.location.create({
        data: {
            vehicleId: vehicle.id,
            latitude: latN,
            longitude: lngN,
            speed: (speed != null && speed !== '') ? Number(speed) : null,
            heading: (heading != null && heading !== '') ? Number(heading) : null,
        },
    });
    publish(vehicleId, {
        latitude: latN,
        longitude: lngN,
        speed: (speed != null && speed !== '') ? Number(speed) : null,
        heading: (heading != null && heading !== '') ? Number(heading) : null,
        altitude: (altitude != null && altitude !== '') ? Number(altitude) : null,
        satellites: (satellites != null && satellites !== '') ? Number(satellites) : null,
        recordedAt: location.recordedAt.toISOString(),
    });
    return { ok: true, locationId: location.id };
}
// GET /api/vehicle/location?vehicleId=X&lat=Y&lng=Z[&speed=S&altitude=A&satellites=N]
// Used by SIM800C (AT+HTTPDATA is broken on old firmware; GET avoids body entirely)
app.get('/api/vehicle/location', async (c) => {
    const { vehicleId, lat, lng, speed, altitude, satellites, heading } = c.req.query();
    console.log('[GET] query:', { vehicleId, lat, lng, speed });
    const result = await saveLocation(vehicleId, lat, lng, speed, altitude, satellites, heading);
    if ('status' in result)
        return c.json({ error: result.error }, result.status);
    return c.json(result);
});
// POST /api/vehicle/location  (JSON body)
app.post('/api/vehicle/location', async (c) => {
    const rawBody = await c.req.text();
    console.log('[POST] raw body:', JSON.stringify(rawBody));
    if (!rawBody || rawBody.trim() === '')
        return c.json({ error: 'Empty body' }, 400);
    let body;
    try {
        body = JSON.parse(rawBody);
    }
    catch {
        return c.json({ error: 'Invalid JSON', received: rawBody }, 400);
    }
    const { vehicleId, lat, lng, speed, altitude, satellites, heading } = body;
    const result = await saveLocation(vehicleId, lat, lng, speed, altitude, satellites, heading);
    if ('status' in result)
        return c.json({ error: result.error }, result.status);
    return c.json(result);
});
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
    });
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
    })));
});
// GET /api/vehicles/:vehicleNumber/latest
app.get('/api/vehicles/:vehicleNumber/latest', async (c) => {
    const vehicleNumber = c.req.param('vehicleNumber');
    const location = await prisma.location.findFirst({
        where: { vehicle: { vehicleNumber } },
        orderBy: { recordedAt: 'desc' },
    });
    if (!location)
        return c.json({ error: 'Not found' }, 404);
    return c.json({
        id: location.id,
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        speed: location.speed !== null ? Number(location.speed) : null,
        heading: location.heading !== null ? Number(location.heading) : null,
        recordedAt: location.recordedAt,
    });
});
// GET /api/vehicles/:vehicleNumber/history?limit=N
app.get('/api/vehicles/:vehicleNumber/history', async (c) => {
    const vehicleNumber = c.req.param('vehicleNumber');
    const limitParam = parseInt(c.req.query('limit') ?? '100', 10);
    const limit = Math.min(Math.max(1, isNaN(limitParam) ? 100 : limitParam), 1000);
    const vehicle = await prisma.vehicle.findUnique({ where: { vehicleNumber } });
    if (!vehicle)
        return c.json({ error: 'Vehicle not found' }, 404);
    const locations = await prisma.location.findMany({
        where: { vehicleId: vehicle.id },
        orderBy: { recordedAt: 'desc' },
        take: limit,
    });
    return c.json(locations.reverse().map(loc => ({
        id: loc.id,
        latitude: Number(loc.latitude),
        longitude: Number(loc.longitude),
        speed: loc.speed !== null ? Number(loc.speed) : null,
        heading: loc.heading !== null ? Number(loc.heading) : null,
        recordedAt: loc.recordedAt,
    })));
});
// GET /api/vehicles/:vehicleNumber/stream  (SSE)
app.get('/api/vehicles/:vehicleNumber/stream', (c) => {
    const vehicleNumber = c.req.param('vehicleNumber');
    return streamSSE(c, async (stream) => {
        let alive = true;
        stream.onAbort(() => { alive = false; });
        // Send latest location immediately on connect
        const latest = await prisma.location.findFirst({
            where: { vehicle: { vehicleNumber } },
            orderBy: { recordedAt: 'desc' },
        });
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
            });
        }
        // Subscribe to published events
        const cb = (data) => {
            if (!alive)
                return;
            void stream.writeSSE({ event: 'location', data: JSON.stringify(data) });
        };
        subscribe(vehicleNumber, cb);
        try {
            while (alive) {
                await stream.sleep(15000);
                if (!alive)
                    break;
                try {
                    await stream.writeSSE({ event: 'ping', data: '' });
                }
                catch {
                    alive = false;
                }
            }
        }
        finally {
            unsubscribe(vehicleNumber, cb);
        }
    });
});
const port = parseInt(process.env.PORT ?? '3001', 10);
serve({ fetch: app.fetch, port }, (info) => {
    console.log(`GPS backend running on http://localhost:${info.port}`);
});
