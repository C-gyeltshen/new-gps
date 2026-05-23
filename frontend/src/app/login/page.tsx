'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { setAuthToken } from '@/lib/auth'

const API = process.env.NEXT_PUBLIC_API_URL

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Login failed'); return }
      setAuthToken(data.token)
      router.push('/')
    } catch {
      setError('Could not connect to server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex">
      {/* Left panel — navy brand */}
      <div className="hidden lg:flex lg:w-5/12 flex-col items-center justify-center p-12 text-white"
        style={{ background: 'linear-gradient(160deg, #7A0000 0%, #B22222 50%, #EF6C00 100%)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Track Net Bhutan" width={120} height={120} className="mb-8 drop-shadow-xl" />
        <h2 className="text-3xl font-bold text-center mb-3">Track Net Bhutan</h2>
        <p className="text-center text-sm opacity-70 mb-8 max-w-xs">
          GPS Tracker · Stay Connected, Stay Secure
        </p>
        <div className="w-12 h-1 rounded-full mb-8" style={{ background: 'var(--orange)' }} />
        <ul className="space-y-4 text-sm opacity-80 max-w-xs">
          {['Real-time GPS tracking', 'Live map with trail history', 'Satellite & terrain views', 'Instant location updates'].map(f => (
            <li key={f} className="flex items-center gap-3">
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0"
                style={{ background: 'var(--orange)' }}>✓</span>
              {f}
            </li>
          ))}
        </ul>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-start sm:items-center justify-center px-6 py-8 bg-[#FBF5EF] overflow-y-auto">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex flex-col items-center mb-8 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Track Net Bhutan" width={80} height={80} className="mb-3" />
            <h1 className="text-xl font-bold" style={{ color: 'var(--navy)' }}>Track Net Bhutan</h1>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {/* Form header */}
            <div className="px-6 py-5 border-b border-gray-100">
              <h2 className="text-xl font-bold" style={{ color: 'var(--navy)' }}>Welcome back</h2>
              <p className="text-sm text-gray-500 mt-0.5">Sign in to your account</p>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-6 space-y-5">
              {error && (
                <div className="text-sm rounded-lg px-4 py-3 border"
                  style={{ background: '#fff1f1', borderColor: '#fca5a5', color: '#dc2626' }}>
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-sm font-medium" style={{ color: 'var(--navy)' }} htmlFor="email">
                  Email address
                </label>
                <input
                  id="email" type="email" required autoComplete="email"
                  value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none transition-all"
                  style={{ '--tw-ring-color': 'var(--navy)' } as React.CSSProperties}
                  onFocus={e => e.target.style.borderColor = 'var(--navy)'}
                  onBlur={e => e.target.style.borderColor = '#e5e7eb'}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium" style={{ color: 'var(--navy)' }} htmlFor="password">
                    Password
                  </label>
                  <Link href="/forgot-password" className="text-xs font-medium hover:underline" style={{ color: 'var(--orange)' }}>
                    Forgot password?
                  </Link>
                </div>
                <input
                  id="password" type="password" required autoComplete="current-password"
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none transition-all"
                  onFocus={e => e.target.style.borderColor = 'var(--navy)'}
                  onBlur={e => e.target.style.borderColor = '#e5e7eb'}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full font-semibold rounded-xl py-3 text-sm transition-all"
                style={{
                  background: loading ? '#7A0000' : '#EF6C00',
                  color: '#ffffff',
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? 'Signing in…' : 'Submit'}
              </button>

              <p className="text-center text-sm text-gray-500">
                No account?{' '}
                <Link href="/signup" className="font-semibold hover:underline" style={{ color: 'var(--orange)' }}>
                  Create one
                </Link>
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
