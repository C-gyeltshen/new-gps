'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

const API = process.env.NEXT_PUBLIC_API_URL

function ResetForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  if (!token) {
    return (
      <div className="text-sm rounded-xl px-4 py-4 text-center"
        style={{ background: '#fff1f1', border: '1px solid #fca5a5', color: '#dc2626' }}>
        <p className="font-semibold mb-1">Invalid link</p>
        <p>No reset token found. Please request a new reset link.</p>
        <Link href="/forgot-password" className="block mt-3 font-semibold hover:underline" style={{ color: '#EF6C00' }}>
          Request new link
        </Link>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }

    setLoading(true)
    try {
      const res = await fetch(`${API}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Reset failed'); return }
      setDone(true)
      setTimeout(() => router.push('/login'), 2500)
    } catch {
      setError('Could not connect to server')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="space-y-5">
        <div className="rounded-xl px-4 py-4 text-sm text-center"
          style={{ background: '#FFF3E0', border: '1px solid #EF6C00', color: '#7A3300' }}>
          <p className="text-2xl mb-2">✓</p>
          <p className="font-semibold mb-1">Password updated!</p>
          <p>Redirecting you to sign in…</p>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="text-sm rounded-lg px-4 py-3 border"
          style={{ background: '#fff1f1', borderColor: '#fca5a5', color: '#dc2626' }}>
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <label className="block text-sm font-medium" style={{ color: '#B22222' }} htmlFor="password">
          New password
        </label>
        <input
          id="password" type="password" required autoComplete="new-password"
          value={password} onChange={e => setPassword(e.target.value)}
          placeholder="At least 6 characters"
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none transition-all"
          onFocus={e => e.target.style.borderColor = '#B22222'}
          onBlur={e => e.target.style.borderColor = '#e5e7eb'}
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium" style={{ color: '#B22222' }} htmlFor="confirm">
          Confirm new password
        </label>
        <input
          id="confirm" type="password" required autoComplete="new-password"
          value={confirm} onChange={e => setConfirm(e.target.value)}
          placeholder="••••••••"
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none transition-all"
          onFocus={e => e.target.style.borderColor = '#B22222'}
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
        {loading ? 'Updating…' : 'Submit'}
      </button>

      <p className="text-center text-sm text-gray-500">
        <Link href="/login" className="font-semibold hover:underline" style={{ color: '#EF6C00' }}>
          Back to sign in
        </Link>
      </p>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-start sm:items-center justify-center px-6 py-12 bg-[#FBF5EF]">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Track Net Bhutan" width={72} height={72} className="mb-3" />
          <h1 className="text-xl font-bold" style={{ color: '#B22222' }}>Track Net Bhutan</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100">
            <h2 className="text-xl font-bold" style={{ color: '#B22222' }}>Set new password</h2>
            <p className="text-sm text-gray-500 mt-0.5">Choose a strong password for your account</p>
          </div>
          <div className="px-6 py-6">
            <Suspense fallback={<p className="text-sm text-gray-400">Loading…</p>}>
              <ResetForm />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  )
}
