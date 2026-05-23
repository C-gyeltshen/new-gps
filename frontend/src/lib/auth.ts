export function getAuthToken(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|;\s*)auth-token=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

export function setAuthToken(token: string) {
  document.cookie = `auth-token=${encodeURIComponent(token)}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`
}

export function clearAuthToken() {
  document.cookie = 'auth-token=; path=/; max-age=0'
}
