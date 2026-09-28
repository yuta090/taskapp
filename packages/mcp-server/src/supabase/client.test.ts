import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * getSupabaseClient() は、change_log トリガー（誰が・どの経路で書いたか。supabase 側
 * PR #1027）向けのヘッダーを、AsyncLocalStorage の認証コンテキストがあるときだけ
 * 自分で組み立てて service_role クライアントに載せる。
 *
 * ⚠ ctx が無い（スクリプト等）ときは、従来どおりヘッダー無しのシングルトンを使い回す。
 * ctx があるときは ctx ごとに1個だけ作る（WeakMap）。同じ呼び出しの中で毎回作り直すと
 * request-id が変わって「1リクエスト=1 request-id」の前提が崩れる。
 */

const createClientCalls: { url: string; key: string; options: Record<string, unknown> }[] = []

vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, options: Record<string, unknown>) => {
    createClientCalls.push({ url, key, options })
    return { __fake: true, callIndex: createClientCalls.length - 1 }
  },
}))

let currentCtx: Record<string, unknown> | null = null

vi.mock('../config.js', () => ({
  config: { supabaseUrl: 'https://example.test', supabaseServiceKey: 'service-key' },
  getAuthContextOrNull: () => currentCtx,
}))

function headersOf(callIndex: number): Record<string, string> {
  const options = createClientCalls[callIndex].options
  return ((options.global as Record<string, unknown> | undefined)?.headers as Record<string, string>) || {}
}

beforeEach(() => {
  createClientCalls.length = 0
  currentCtx = null
  vi.resetModules()
})

describe('getSupabaseClient — ctx が無いとき', () => {
  it('ヘッダー無しのシングルトンを使い回す', async () => {
    const { getSupabaseClient } = await import('./client.js')
    const a = getSupabaseClient()
    const b = getSupabaseClient()

    expect(a).toBe(b)
    expect(createClientCalls).toHaveLength(1)
    expect(headersOf(0)).toEqual({})
  })
})

describe('getSupabaseClient — ctx があるとき', () => {
  it('x-agentpm-channel と x-agentpm-request-id を必ず付ける', async () => {
    currentCtx = {
      keyId: 'kid-1',
      userId: null,
      channel: 'cli',
    }
    const { getSupabaseClient } = await import('./client.js')
    getSupabaseClient()

    const headers = headersOf(0)
    expect(headers['x-agentpm-channel']).toBe('cli')
    expect(headers['x-agentpm-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('userId があれば x-agentpm-actor-id を付ける', async () => {
    currentCtx = { keyId: 'kid-1', userId: 'user-1', channel: 'mcp' }
    const { getSupabaseClient } = await import('./client.js')
    getSupabaseClient()

    expect(headersOf(0)['x-agentpm-actor-id']).toBe('user-1')
  })

  it('userId が無ければ x-agentpm-actor-id を付けない', async () => {
    currentCtx = { keyId: 'kid-1', userId: null, channel: 'mcp' }
    const { getSupabaseClient } = await import('./client.js')
    getSupabaseClient()

    expect(headersOf(0)).not.toHaveProperty('x-agentpm-actor-id')
  })

  it('keyId があれば x-agentpm-api-key-id を付ける', async () => {
    currentCtx = { keyId: 'kid-1', userId: null, channel: 'mcp' }
    const { getSupabaseClient } = await import('./client.js')
    getSupabaseClient()

    expect(headersOf(0)['x-agentpm-api-key-id']).toBe('kid-1')
  })

  it('keyId が dev-key（開発用の目印）なら x-agentpm-api-key-id を付けない', async () => {
    currentCtx = { keyId: 'dev-key', userId: 'user-1', channel: 'cli' }
    const { getSupabaseClient } = await import('./client.js')
    getSupabaseClient()

    expect(headersOf(0)).not.toHaveProperty('x-agentpm-api-key-id')
  })

  it('同じ ctx オブジェクトでは作り直さない（request-id が変わらない）', async () => {
    currentCtx = { keyId: 'kid-1', userId: 'user-1', channel: 'cli' }
    const { getSupabaseClient } = await import('./client.js')
    const a = getSupabaseClient()
    const b = getSupabaseClient()

    expect(a).toBe(b)
    expect(createClientCalls).toHaveLength(1)
  })

  it('別の ctx オブジェクトは別のクライアント（別の request-id）を作る', async () => {
    const { getSupabaseClient } = await import('./client.js')

    currentCtx = { keyId: 'kid-1', userId: 'user-1', channel: 'cli' }
    getSupabaseClient()
    const requestIdA = headersOf(0)['x-agentpm-request-id']

    currentCtx = { keyId: 'kid-2', userId: 'user-2', channel: 'mcp' }
    getSupabaseClient()
    const requestIdB = headersOf(1)['x-agentpm-request-id']

    expect(createClientCalls).toHaveLength(2)
    expect(requestIdA).not.toBe(requestIdB)
  })
})
