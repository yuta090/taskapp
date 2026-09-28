import { describe, it, expect, vi } from 'vitest'

/**
 * getSupabaseClient() のヘッダー組み立てを、モックの ctx ではなく本物の
 * AsyncLocalStorage（config.ts の runWithAuthContext）を通して確かめる。
 * dispatch.concurrency.test.ts は「ctx そのものが混線しないか」を見るが、
 * ここでは「その ctx から作られる Supabase クライアントのヘッダーが混線しないか」
 * を直接見る（supabase-js 自体はモックし、DB へは飛ばさない）。
 */

// config.ts はモックせず本物を使うため、モジュール読み込み時の設定確認を満たしておく
// （createClient 自体はモック済みで、実際に DB へは飛ばない）
process.env.SUPABASE_URL ||= 'https://example.test'
process.env.SUPABASE_SERVICE_KEY ||= 'service-key'

const createClientCalls: { options: Record<string, unknown> }[] = []

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, options: Record<string, unknown>) => {
    createClientCalls.push({ options })
    return { __fake: true }
  },
}))

function headerOf(callIndex: number, name: string): string | undefined {
  const options = createClientCalls[callIndex].options
  const headers = (options.global as Record<string, unknown> | undefined)?.headers as
    | Record<string, string>
    | undefined
  return headers?.[name]
}

function gate() {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

describe('getSupabaseClient — 同時実行でもヘッダーが混線しない', () => {
  it('割り込んでも、それぞれ自分の actor-id / channel のヘッダーを持つクライアントを見る', async () => {
    const { runWithAuthContext } = await import('../config.js')
    const { getSupabaseClient } = await import('./client.js')

    const alphaEntered = gate()
    const alphaMayFinish = gate()

    const alphaCtx = {
      keyId: 'kid-alpha',
      userId: 'user-alpha',
      orgId: 'org-alpha',
      scope: 'org' as const,
      allowedSpaceIds: null,
      allowedActions: ['read'] as const,
      channel: 'stdio' as const,
    }
    const betaCtx = {
      keyId: 'kid-beta',
      userId: 'user-beta',
      orgId: 'org-beta',
      scope: 'org' as const,
      allowedSpaceIds: null,
      allowedActions: ['read'] as const,
      channel: 'mcp' as const,
    }

    const alphaCallIndex: { value: number | null } = { value: null }

    const alpha = runWithAuthContext(alphaCtx, async () => {
      alphaEntered.open()
      await alphaMayFinish.promise
      getSupabaseClient()
      alphaCallIndex.value = createClientCalls.length - 1
    })

    await alphaEntered.promise

    await runWithAuthContext(betaCtx, async () => {
      getSupabaseClient()
    })
    const betaCallIndex = createClientCalls.length - 1

    alphaMayFinish.open()
    await alpha

    expect(alphaCallIndex.value).not.toBeNull()
    // beta が先に走り終わっても、あとから完了する alpha は自分の actor-id/channel を見る
    expect(headerOf(alphaCallIndex.value as number, 'x-agentpm-actor-id')).toBe('user-alpha')
    expect(headerOf(alphaCallIndex.value as number, 'x-agentpm-channel')).toBe('stdio')
    expect(headerOf(betaCallIndex, 'x-agentpm-actor-id')).toBe('user-beta')
    expect(headerOf(betaCallIndex, 'x-agentpm-channel')).toBe('mcp')
  })
})
