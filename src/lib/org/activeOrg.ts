import { ACTIVE_ORG_COOKIE, ACTIVE_ORG_MAX_AGE } from './constants'

export { ACTIVE_ORG_COOKIE }

export function getActiveOrgId(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${ACTIVE_ORG_COOKIE}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export function setActiveOrgId(orgId: string): void {
  if (typeof document === 'undefined') return
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${ACTIVE_ORG_COOKIE}=${encodeURIComponent(orgId)}; path=/; SameSite=Lax${secure}; max-age=${ACTIVE_ORG_MAX_AGE}`
}

export function clearActiveOrgId(): void {
  if (typeof document === 'undefined') return
  document.cookie = `${ACTIVE_ORG_COOKIE}=; path=/; max-age=0`
}
