'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, Popup, CircleMarker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { LivePoint } from './LiveMap'

export type MapType = 'street' | 'satellite' | 'terrain' | 'hybrid'

const TILES: Record<MapType, { url: string; attribution: string; overlay?: string }> = {
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri &mdash; Source: Esri, Maxar, GeoEye',
  },
  terrain: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
  },
  hybrid: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri &mdash; Source: Esri, Maxar, GeoEye',
    overlay: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  },
}

const vehicleIcon = L.icon({
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
  mapType,
  userLocation,
}: {
  current: LivePoint | null
  trail: [number, number][]
  mapType: MapType
  userLocation?: [number, number] | null
}) {
  const center: [number, number] = current
    ? [current.latitude, current.longitude]
    : trail.length > 0
      ? trail[trail.length - 1]
      : BHUTAN_FALLBACK

  const tile = TILES[mapType]

  return (
    <div style={{ height: 'clamp(300px, 50vh, 560px)', width: '100%' }}>
      <MapContainer
        center={center}
        zoom={16}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
      >
        <TileLayer key={mapType} url={tile.url} attribution={tile.attribution} />
        {mapType === 'hybrid' && tile.overlay && (
          <TileLayer key="hybrid-labels" url={tile.overlay} attribution="" />
        )}

        {trail.length > 1 && (
          <Polyline positions={trail} color="#EF6C00" weight={3} opacity={0.8} />
        )}

        {/* Vehicle marker */}
        {current && (
          <Marker position={[current.latitude, current.longitude]} icon={vehicleIcon}>
            <Popup>
              <div className="text-sm space-y-1 min-w-[140px]">
                <p className="font-semibold">🚗 Vehicle</p>
                <p><strong>Lat:</strong> {current.latitude.toFixed(6)}</p>
                <p><strong>Lng:</strong> {current.longitude.toFixed(6)}</p>
                {current.speed != null && (
                  <p><strong>Speed:</strong> {current.speed.toFixed(1)} km/h</p>
                )}
                {current.altitude != null && (
                  <p><strong>Alt:</strong> {current.altitude.toFixed(0)} m</p>
                )}
                {current.satellites != null && (
                  <p><strong>Sats:</strong> {current.satellites}</p>
                )}
              </div>
            </Popup>
          </Marker>
        )}

        {/* User location — blue pulsing dot */}
        {userLocation && (
          <>
            {/* Outer accuracy ring */}
            <CircleMarker
              center={userLocation}
              radius={18}
              fillColor="#3b82f6"
              color="#3b82f6"
              weight={1}
              fillOpacity={0.15}
            />
            {/* Inner dot */}
            <CircleMarker
              center={userLocation}
              radius={8}
              fillColor="#3b82f6"
              color="white"
              weight={2.5}
              fillOpacity={1}
            >
              <Popup>
                <div className="text-sm space-y-1">
                  <p className="font-semibold">📍 Your location</p>
                  <p><strong>Lat:</strong> {userLocation[0].toFixed(6)}</p>
                  <p><strong>Lng:</strong> {userLocation[1].toFixed(6)}</p>
                </div>
              </Popup>
            </CircleMarker>
          </>
        )}

        {current && <Recenter pos={[current.latitude, current.longitude]} />}
      </MapContainer>
    </div>
  )
}
