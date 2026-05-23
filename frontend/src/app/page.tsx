import Link from 'next/link'

interface LatestLocation {
  latitude: number
  longitude: number
  speed: number | null
  recordedAt: string
}

interface Vehicle {
  id: string
  vehicleNumber: string
  latestLocation: LatestLocation | null
}

export default async function Home() {
  let vehicles: Vehicle[] = []
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vehicles`, { cache: 'no-store' })
    vehicles = await res.json()
  } catch { /* backend not reachable */ }

  return (
    <div className="px-4 py-8 sm:px-8 max-w-5xl mx-auto">
      {/* Page header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: 'var(--navy)' }}>
            Fleet Overview
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''} registered
          </p>
        </div>
        {/* Live indicator */}
        <div className="flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-full"
          style={{ background: 'var(--orange-light)', color: 'var(--orange)' }}>
          <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--orange)' }} />
          Live
        </div>
      </div>

      {vehicles.length === 0 ? (
        <div className="text-center py-24 rounded-2xl border-2 border-dashed border-gray-200 bg-white">
          <div className="text-5xl mb-4">📡</div>
          <p className="text-lg font-semibold" style={{ color: 'var(--navy)' }}>No vehicles yet</p>
          <p className="text-sm text-gray-400 mt-1">POST to /api/vehicle/location to register a vehicle.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {vehicles.map(v => {
            const isLive = !!v.latestLocation
            return (
              <Link
                key={v.id}
                href={`/vehicle/${encodeURIComponent(v.vehicleNumber)}`}
                className="group block bg-white rounded-2xl border overflow-hidden transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0"
                style={{ borderColor: isLive ? 'var(--orange)' : '#e5e7eb' }}
              >
                {/* Card top bar */}
                <div className="h-1.5" style={{ background: isLive ? 'var(--orange)' : '#e5e7eb' }} />

                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Vehicle ID</p>
                      <p className="font-bold text-lg leading-tight" style={{ color: 'var(--navy)' }}>
                        {v.vehicleNumber}
                      </p>
                    </div>
                    <span
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                      style={
                        isLive
                          ? { background: 'var(--orange-light)', color: 'var(--orange)' }
                          : { background: '#f3f4f6', color: '#9ca3af' }
                      }
                    >
                      {isLive ? '● Live' : '○ No data'}
                    </span>
                  </div>

                  {v.latestLocation ? (
                    <>
                      <div className="flex items-center gap-1.5 text-sm text-gray-600 font-mono mb-2">
                        <span>📍</span>
                        <span>
                          {v.latestLocation.latitude.toFixed(5)}, {v.latestLocation.longitude.toFixed(5)}
                        </span>
                      </div>
                      {v.latestLocation.speed !== null && (
                        <div className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--navy)' }}>
                          <span>⚡</span>
                          <span>{v.latestLocation.speed.toFixed(1)} km/h</span>
                        </div>
                      )}
                      <p className="text-xs text-gray-400 mt-3 pt-3 border-t border-gray-100">
                        {new Date(v.latestLocation.recordedAt).toLocaleString()}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400 mt-2">Awaiting first signal…</p>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
