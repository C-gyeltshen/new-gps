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
    <main className="p-8 max-w-5xl mx-auto">
      <div className="mb-4">
        <Link href="/" className="text-blue-600 hover:underline text-sm">
          &larr; Back to vehicles
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-6">Vehicle: {decoded}</h1>
      <LiveMap vehicleNumber={decoded} />
    </main>
  )
}
