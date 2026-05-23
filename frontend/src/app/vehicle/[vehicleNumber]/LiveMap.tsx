'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'

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

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="border rounded-xl p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-semibold mt-1 ${highlight ? 'text-green-600' : ''}`}>
        {value}
      </p>
    </div>
  )
}

export default function LiveMap({ vehicleNumber }: { vehicleNumber: string }) {
  const [current, setCurrent] = useState<LivePoint | null>(null)
  const [trail, setTrail] = useState<[number, number][]>([])
  const [connected, setConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const encoded = encodeURIComponent(vehicleNumber)

    // Seed trail from history
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

    // Open SSE stream
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

    return () => {
      es.close()
    }
  }, [vehicleNumber])

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Status"
          value={connected ? 'Live' : 'Offline'}
          highlight={connected}
        />
        <StatCard
          label="Latitude"
          value={current ? current.latitude.toFixed(6) : '—'}
        />
        <StatCard
          label="Longitude"
          value={current ? current.longitude.toFixed(6) : '—'}
        />
        <StatCard
          label="Speed"
          value={
            current?.speed != null ? `${current.speed.toFixed(1)} km/h` : '—'
          }
        />
      </div>

      <MapView current={current} trail={trail} />

      {lastUpdate && (
        <p className="text-xs text-gray-400 mt-2">
          Last update: {new Date(lastUpdate).toLocaleTimeString()}
        </p>
      )}
    </div>
  )
}
