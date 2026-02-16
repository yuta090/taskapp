export const ACTIVE_ORG_COOKIE = 'taskapp:activeOrgId'
export const ACTIVE_ORG_MAX_AGE = 31536000 // 1 year

/** Server-side cookie options (Next.js ResponseCookies compatible) */
export const ACTIVE_ORG_COOKIE_OPTIONS = {
  path: '/',
  sameSite: 'lax' as const,
  maxAge: ACTIVE_ORG_MAX_AGE,
}
