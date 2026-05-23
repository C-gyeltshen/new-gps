'use client'

import { useRouter } from 'next/navigation'
import { clearAuthToken } from '@/lib/auth'

export default function HeaderActions() {
  const router = useRouter()

  function logout() {
    clearAuthToken()
    router.push('/login')
  }

  return (
    <button
      onClick={logout}
      className="text-xs sm:text-sm font-medium px-3 py-1.5 rounded-lg border transition-all"
      style={{ color: 'var(--orange)', borderColor: 'var(--orange)' }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--orange)';
        (e.currentTarget as HTMLButtonElement).style.color = 'white';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--orange)';
      }}
    >
      Sign out
    </button>
  )
}
