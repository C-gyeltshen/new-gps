'use client'

import Link from 'next/link'
import { useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Something went wrong')
        return
      }
      setSubmitted(true)
    } catch {
      setError('Could not connect to server')
    } finally {
      setLoading(false)
    }
  }

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
            <h2 className="text-xl font-bold" style={{ color: '#B22222' }}>Reset password</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Enter your email and a reset link will be generated
            </p>
          </div>

          <div className="px-6 py-6">
            {submitted ? (
              <div className="space-y-5">
                <div className="rounded-xl px-4 py-4 text-sm"
                  style={{ background: '#FFF3E0', border: '1px solid #EF6C00', color: '#7A3300' }}>
                  <p className="font-semibold mb-1">Reset link generated</p>
                  <p>
                    If that email is registered, a reset link has been logged to the{' '}
                    <strong>server console</strong>. Ask your administrator to share the link with you.
                  </p>
                </div>
                <Link
                  href="/login"
                  className="block w-full text-center font-semibold rounded-xl py-3 text-sm text-white transition-all"
                  style={{ background: '#EF6C00' }}
                >
                  Back to sign in
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                {error && (
                  <div className="text-sm rounded-lg px-4 py-3 border"
                    style={{ background: '#fff1f1', borderColor: '#fca5a5', color: '#dc2626' }}>
                    {error}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-sm font-medium" style={{ color: '#B22222' }} htmlFor="email">
                    Email address
                  </label>
                  <input
                    id="email" type="email" required autoComplete="email"
                    value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
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
                  {loading ? 'Sending…' : 'Submit'}
                </button>

                <p className="text-center text-sm text-gray-500">
                  Remember your password?{' '}
                  <Link href="/login" className="font-semibold hover:underline" style={{ color: '#EF6C00' }}>
                    Sign in
                  </Link>
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
