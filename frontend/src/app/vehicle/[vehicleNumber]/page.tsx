import Link from 'next/link'
import LiveMap from './LiveMap'

export default async function VehiclePage({
  params,
}: {
  params: Promise<{ vehicleNumber: string }>
}) {
  const { vehicleNumber } = await params
  const decoded = decodeURIComponent(vehicleNumber)

  return (
    <div className="px-4 py-4 sm:px-8 sm:py-6 max-w-5xl mx-auto">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm font-medium mb-4 hover:underline"
        style={{ color: 'var(--orange)' }}
      >
        ← Fleet Overview
      </Link>
      <h1 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 truncate" style={{ color: 'var(--navy)' }}>
        {decoded}
      </h1>
      <LiveMap vehicleNumber={decoded} />
    </div>
  )
}
