import { describe, it, expect, beforeEach, afterEach } from 'vitest'

/**
 * GitHub App の OAuth state（HMAC 署名付き）。
 *
 * インストール完了時に GitHub 側で利用者本人であることを確認するため、
 * state には「誰が始めたか」（利用者 ID）も入れておき、戻ってきたログインユーザーと
 * 一致するかをコールバック側で照合できるようにする。利用者 ID の入っていない
 * 古い形式の state は無効として扱う。
 */
// state は `base64url({ payload, signature })` の形。テストで payload を書き換えたり
// 別の鍵で署名し直したりするための最小限のエンコード/デコード（config.ts の実装と同じ形式）
function encodeStateEnvelope(payload: string, signature: string): string {
  return Buffer.from(JSON.stringify({ payload, signature }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function decodeStateEnvelope(state: string): { payload: string; signature: string } {
  const base64 = state.replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
}

describe('createSignedState / verifySignedState', () => {
  const ORG_ID = '322a219f-1a73-4935-b061-08b8a5e97334'
  const REDIRECT = '/settings/org-integrations'
  const USER_ID = '526fb8e1-0b6a-4ffd-86a3-b3e59db3476a'

  const ORIGINAL_SECRET = process.env.GITHUB_STATE_SECRET

  beforeEach(() => {
    process.env.GITHUB_STATE_SECRET = 'test-state-secret'
  })

  afterEach(() => {
    process.env.GITHUB_STATE_SECRET = ORIGINAL_SECRET
  })

  it('利用者 ID を含めて署名し、検証で取り出せる', async () => {
    const { createSignedState, verifySignedState } = await import('./config')
    const state = createSignedState(ORG_ID, REDIRECT, USER_ID)
    expect(verifySignedState(state)).toEqual({ orgId: ORG_ID, redirectUri: REDIRECT, userId: USER_ID })
  })

  it('利用者 ID の入っていない state（古い形式）は無効', async () => {
    const { createHmac } = await import('node:crypto')
    const { verifySignedState } = await import('./config')

    const payload = JSON.stringify({ orgId: ORG_ID, redirectUri: REDIRECT, ts: Date.now() })
    const signature = createHmac('sha256', 'test-state-secret').update(payload).digest('hex')
    const legacyState = encodeStateEnvelope(payload, signature)

    expect(verifySignedState(legacyState)).toBeNull()
  })

  it('payload を書き換えて元の署名のまま詰め直した state は無効（署名の照合まで届いていることを確かめる）', async () => {
    const { createSignedState, verifySignedState } = await import('./config')
    const state = createSignedState(ORG_ID, REDIRECT, USER_ID)
    const { payload, signature } = decodeStateEnvelope(state)

    const tampered = JSON.parse(payload)
    tampered.sub = 'someone-elses-user-id'
    const tamperedState = encodeStateEnvelope(JSON.stringify(tampered), signature)

    expect(verifySignedState(tamperedState)).toBeNull()
  })

  it('別の鍵で署名した state は無効', async () => {
    const { createHmac } = await import('node:crypto')
    const { verifySignedState } = await import('./config')

    const payload = JSON.stringify({ orgId: ORG_ID, redirectUri: REDIRECT, sub: USER_ID, ts: Date.now() })
    const signature = createHmac('sha256', 'a-different-secret').update(payload).digest('hex')
    const state = encodeStateEnvelope(payload, signature)

    expect(verifySignedState(state)).toBeNull()
  })

  it('期限切れの state は無効', async () => {
    const { createHmac } = await import('node:crypto')
    const { verifySignedState } = await import('./config')

    const payload = JSON.stringify({ orgId: ORG_ID, redirectUri: REDIRECT, sub: USER_ID, ts: Date.now() - 16 * 60 * 1000 })
    const signature = createHmac('sha256', 'test-state-secret').update(payload).digest('hex')
    const expiredState = encodeStateEnvelope(payload, signature)

    expect(verifySignedState(expiredState)).toBeNull()
  })
})
