import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { checkAal2 } from '@/lib/auth/requireAal2'

/**
 * Bearer トークンで作ったクライアントはセッションを持たない（getSession が null）。
 * そのままだと2段階認証を登録した人が必ず弾かれるので、確かめ済みのトークンを直接渡せるようにする。
 */

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (aal: string) => `${b64({ alg: 'HS256' })}.${b64({ aal })}.sig`
const enrolled = { id: 'u1', factors: [{ status: 'verified' }] } as unknown as User
const notEnrolled = { id: 'u1' } as unknown as User

function bearerLikeClient() {
  const getSession = vi.fn(async () => ({ data: { session: null } }))
  return { client: { auth: { getSession } } as unknown as SupabaseClient, getSession }
}

describe('checkAal2 — accessToken を渡したとき', () => {
  it('登録済みで aal1 のトークンなら mfa_required', async () => {
    const { client } = bearerLikeClient()
    expect(await checkAal2(client, { user: enrolled, accessToken: jwt('aal1') })).toMatchObject({
      ok: false,
      reason: 'mfa_required',
    })
  })

  it('登録済みで aal2 のトークンなら通し、getSession は呼ばない', async () => {
    const { client, getSession } = bearerLikeClient()
    expect(await checkAal2(client, { user: enrolled, accessToken: jwt('aal2') })).toMatchObject({ ok: true })
    expect(getSession).not.toHaveBeenCalled()
  })

  it('登録していない人は aal1 でも通す', async () => {
    const { client } = bearerLikeClient()
    expect(await checkAal2(client, { user: notEnrolled, accessToken: jwt('aal1') })).toMatchObject({ ok: true })
  })

  it('トークンを渡さずに Bearer のクライアントで確かめると、登録済みの人は弾かれる（渡し忘れの罠を固定する）', async () => {
    const { client } = bearerLikeClient()
    expect(await checkAal2(client, { user: enrolled })).toMatchObject({ ok: false, reason: 'mfa_required' })
  })
})
