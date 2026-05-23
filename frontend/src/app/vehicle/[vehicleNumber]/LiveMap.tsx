'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import type { MapType } from './MapView'

export type LivePoint = {
  latitude: number
  longitude: number
  speed: number | null
  heading: number | null
  altitude?: number | null
  satellites?: number | null
  recordedAt: string
}

const MapView = dynamic(() => import('./MapView'), { ssr: false })

const API = process.env.NEXT_PUBLIC_API_URL

const MAP_TYPES: { id: MapType; label: string; icon: string }[] = [
  { id: 'street',    label: 'Street',    icon: '🗺️' },
  { id: 'satellite', label: 'Satellite', icon: '🛰️' },
  { id: 'terrain',   label: 'Terrain',   icon: '⛰️' },
  { id: 'hybrid',    label: 'Hybrid',    icon: '🌍' },
]

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371
  const dLat = (b[0] - a[0]) * Math.PI / 180
  const dLon = (b[1] - a[1]) * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toFixed(1)} km`
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return '< 1 min'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h === 0) return `${m} min`
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`
}

function StatCard({
  label,
  value,
  highlight,
  sub,
}: {
  label: string
  value: string
  highlight?: boolean
  sub?: string
}) {
  return (
    <div className="bg-white border rounded-xl p-3 sm:p-4"
      style={highlight ? { borderColor: 'var(--orange)', background: 'var(--orange-light)' } : {}}>
      <p className="text-[10px] sm:text-xs uppercase tracking-wide font-medium text-gray-500">
        {label}
      </p>
      <p className="text-base sm:text-lg font-semibold mt-0.5 sm:mt-1 truncate"
        style={highlight ? { color: 'var(--orange)' } : { color: 'var(--navy-dark)' }}>
        {value}
      </p>
      {sub && <p className="text-[10px] sm:text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

type RouteInfo = { duration: number; distance: number }

export default function LiveMap({ vehicleNumber }: { vehicleNumber: string }) {
  const [current, setCurrent] = useState<LivePoint | null>(null)
  const [trail, setTrail] = useState<[number, number][]>([])
  const [connected, setConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<string | null>(null)
  const [mapType, setMapType] = useState<MapType>('street')
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const currentRef = useRef<LivePoint | null>(null)
  const esRef = useRef<EventSource | null>(null)

  // Keep currentRef in sync so fetchRoute can read latest vehicle position
  useEffect(() => { currentRef.current = current }, [current])

  useEffect(() => {
    const encoded = encodeURIComponent(vehicleNumber)

    fetch(`${API}/api/vehicles/${encoded}/history?limit=200`)
      .then(r => r.json())
      .then((points: LivePoint[]) => {
        if (!Array.isArray(points)) return
        setTrail(points.map(p => [p.latitude, p.longitude]))
        if (points.length > 0) {
          const last = points[points.length - 1]
          setCurrent(last)
          setLastUpdate(last.recordedAt)
        }
      })
      .catch(() => {})

    const es = new EventSource(`${API}/api/vehicles/${encoded}/stream`)
    esRef.current = es

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    es.addEventListener('location', (e: MessageEvent) => {
      const point: LivePoint = JSON.parse(e.data)
      setCurrent(point)
      setLastUpdate(point.recordedAt)
      setTrail(prev => {
        const next: [number, number][] = [...prev, [point.latitude, point.longitude]]
        return next.length > 500 ? next.slice(next.length - 500) : next
      })
    })

    return () => { es.close() }
  }, [vehicleNumber])

  async function fetchRoute(from: [number, number], to: [number, number]) {
    setRouteLoading(true)
    setRouteError(null)
    try {
      // OSRM uses (lng, lat) order
      const url = `https://router.project-osrm.org/route/v1/driving/` +
        `${from[1]},${from[0]};${to[1]},${to[0]}?overview=false`
      const res = await fetch(url)
      const data = await res.json()
      if (data.code !== 'Ok' || !data.routes?.length) {
        setRouteError('No route found between the two locations')
        setRouteInfo(null)
        return
      }
      setRouteInfo({ duration: data.routes[0].duration, distance: data.routes[0].distance })
    } catch {
      setRouteError('Could not fetch route — check your connection')
    } finally {
      setRouteLoading(false)
    }
  }

  function locateMe() {
    if (!navigator.geolocation) {
      setLocateError('Geolocation is not supported by your browser')
      return
    }
    setLocating(true)
    setLocateError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc: [number, number] = [pos.coords.latitude, pos.coords.longitude]
        setUserLocation(loc)
        setLocating(false)
        // Immediately fetch route if vehicle position is known
        const veh = currentRef.current
        if (veh) fetchRoute(loc, [veh.latitude, veh.longitude])
      },
      (err) => {
        setLocateError(
          err.code === 1 ? 'Location permission denied'
          : err.code === 2 ? 'Location unavailable'
          : 'Could not get location'
        )
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  function refreshRoute() {
    if (!userLocation || !current) return
    fetchRoute(userLocation, [current.latitude, current.longitude])
  }

  const straightLine = userLocation && current
    ? haversineKm(userLocation, [current.latitude, current.longitude])
    : null

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Primary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        <StatCard label="Status" value={connected ? 'Live' : 'Offline'} highlight={connected} />
        <StatCard
          label="Speed"
          value={current?.speed != null ? `${current.speed.toFixed(1)}` : '—'}
          sub={current?.speed != null ? 'km/h' : undefined}
        />
        <StatCard label="Latitude"  value={current ? current.latitude.toFixed(5)  : '—'} />
        <StatCard label="Longitude" value={current ? current.longitude.toFixed(5) : '—'} />
      </div>

      {/* Location-aware stat cards */}
      {(straightLine != null || current?.altitude != null || current?.satellites != null) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          {current?.altitude   != null && <StatCard label="Altitude"   value={`${current.altitude.toFixed(0)} m`} />}
          {current?.satellites != null && <StatCard label="Satellites" value={String(current.satellites)} />}
          {straightLine != null && (
            <StatCard label="Straight-line" value={formatDistance(straightLine)} sub="to vehicle" />
          )}
        </div>
      )}

      {/* Route / ETA card */}
      {userLocation && (
        <div className="bg-white border rounded-xl p-3 sm:p-4"
          style={{ borderColor: '#3b82f6', borderWidth: '1.5px' }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] sm:text-xs uppercase tracking-wide font-medium text-gray-500">
              Estimated drive to vehicle
            </p>
            <button
              onClick={refreshRoute}
              disabled={routeLoading || !current}
              className="text-[10px] font-medium px-2 py-0.5 rounded border transition-all"
              style={{ color: '#3b82f6', borderColor: '#3b82f6', opacity: routeLoading ? 0.5 : 1 }}
            >
              {routeLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {routeLoading && !routeInfo && (
            <p className="text-sm text-gray-400">Calculating route…</p>
          )}

          {routeError && !routeInfo && (
            <p className="text-sm" style={{ color: '#dc2626' }}>{routeError}</p>
          )}

          {routeInfo && (
            <div className="flex items-end gap-4">
              <div>
                <p className="text-2xl sm:text-3xl font-bold" style={{ color: '#3b82f6' }}>
                  {formatDuration(routeInfo.duration)}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {(routeInfo.distance / 1000).toFixed(1)} km by road
                </p>
              </div>
              {routeLoading && (
                <p className="text-xs text-gray-400 mb-1">Updating…</p>
              )}
            </div>
          )}

          {!routeInfo && !routeLoading && !routeError && (
            <p className="text-sm text-gray-400">Click Refresh to calculate drive time</p>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {MAP_TYPES.map(t => (
          <button
            key={t.id}
            onClick={() => setMapType(t.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-all shrink-0 border"
            style={
              mapType === t.id
                ? { background: 'var(--orange)', color: 'white', borderColor: 'var(--orange)' }
                : { background: 'white', color: '#4b5563', borderColor: '#e5e7eb' }
            }
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}

        <div className="h-5 w-px bg-gray-200 shrink-0 mx-1" />

        <button
          onClick={locateMe}
          disabled={locating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-all shrink-0 border"
          style={
            userLocation
              ? { background: '#3b82f6', color: 'white', borderColor: '#3b82f6' }
              : { background: 'white', color: '#4b5563', borderColor: '#e5e7eb' }
          }
        >
          <span>{locating ? '⏳' : '📍'}</span>
          <span>{locating ? 'Locating…' : 'My Location'}</span>
        </button>
      </div>

      {locateError && (
        <p className="text-xs px-3 py-2 rounded-lg border"
          style={{ background: '#fff1f1', borderColor: '#fca5a5', color: '#dc2626' }}>
          {locateError}
        </p>
      )}

      {/* Map */}
      <div className="rounded-xl overflow-hidden border shadow-sm">
        <MapView current={current} trail={trail} mapType={mapType} userLocation={userLocation} />
      </div>

      {lastUpdate && (
        <p className="text-[11px] sm:text-xs text-gray-400 text-right">
          Last update: {new Date(lastUpdate).toLocaleTimeString()}
        </p>
      )}
    </div>
  )
}
