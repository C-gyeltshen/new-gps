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
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vehicles`, {
      cache: 'no-store',
    })
    vehicles = await res.json()
  } catch {
    // backend not reachable
  }

  return (
    <main className="p-8 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Live Vehicle Tracker</h1>
      <p className="text-gray-500 mb-8">Real-time GPS tracking</p>

      {vehicles.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">No vehicles tracked yet.</p>
          <p className="text-sm mt-2">POST to /api/vehicle/location to register a vehicle.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {vehicles.map(v => (
            <Link
              key={v.id}
              href={`/vehicle/${encodeURIComponent(v.vehicleNumber)}`}
              className="block border rounded-xl p-5 hover:shadow-md hover:border-blue-400 transition-all"
            >
              <div className="flex items-center gap-2 mb-3">
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full ${
                    v.latestLocation ? 'bg-green-500' : 'bg-gray-300'
                  }`}
                />
                <span className="font-semibold text-lg">{v.vehicleNumber}</span>
              </div>
              {v.latestLocation ? (
                <>
                  <p className="text-sm text-gray-600 font-mono">
                    {v.latestLocation.latitude.toFixed(6)},{' '}
                    {v.latestLocation.longitude.toFixed(6)}
                  </p>
                  {v.latestLocation.speed !== null && (
                    <p className="text-sm text-gray-500 mt-1">
                      {v.latestLocation.speed.toFixed(1)} km/h
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-2">
                    {new Date(v.latestLocation.recordedAt).toLocaleString()}
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-400">No location data yet</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
