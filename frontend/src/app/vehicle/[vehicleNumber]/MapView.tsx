'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { LivePoint } from './LiveMap'

const markerIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

const BHUTAN_FALLBACK: [number, number] = [27.4712, 89.6339]

function Recenter({ pos }: { pos: [number, number] }) {
  const map = useMap()
  useEffect(() => {
    map.setView(pos, map.getZoom(), { animate: true })
  }, [pos, map])
  return null
}

export default function MapView({
  current,
  trail,
}: {
  current: LivePoint | null
  trail: [number, number][]
}) {
  const center: [number, number] = current
    ? [current.latitude, current.longitude]
    : trail.length > 0
      ? trail[trail.length - 1]
      : BHUTAN_FALLBACK

  return (
    <MapContainer
      center={center}
      zoom={16}
      style={{ height: '560px', width: '100%' }}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {trail.length > 1 && (
        <Polyline positions={trail} color="#2563eb" />
      )}
      {current && (
        <Marker
          position={[current.latitude, current.longitude]}
          icon={markerIcon}
        >
          <Popup>
            <div className="text-sm space-y-1">
              <p><strong>Lat:</strong> {current.latitude.toFixed(6)}</p>
              <p><strong>Lng:</strong> {current.longitude.toFixed(6)}</p>
              {current.speed != null && (
                <p><strong>Speed:</strong> {current.speed.toFixed(1)} km/h</p>
              )}
              {current.satellites != null && (
                <p><strong>Satellites:</strong> {current.satellites}</p>
              )}
            </div>
          </Popup>
        </Marker>
      )}
      {current && <Recenter pos={[current.latitude, current.longitude]} />}
    </MapContainer>
  )
}
