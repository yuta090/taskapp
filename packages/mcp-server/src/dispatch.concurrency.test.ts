import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * リモートMCP(複数の利用者が同時に叩く)に向けた、テナント分離と並行性の回帰テスト。
 *
 * 現行の実装は認証コンテキストをモジュールグローバル(config)に置き、dispatch 側の
 * Promise チェーンで全リクエストを直列化して混線を避けている。stdio(1プロセス1利用者)
 * では成立するが、HTTP の受け口では
 *   1. 直列化 = 1人の遅いツール呼び出しが他の全員を待たせる
 *   2. 直列化を外した瞬間にテナント混線(別の組織のデータが見える)
 * となる。よって「並行に走れる」かつ「各呼び出しが自分の認証コンテキストを見続ける」の
 * 両方を満たす必要がある。
 *
 * ⚠ ここが壊れると別組織のデータが見える。実装を軽くするために直列化へ戻さないこと。
 */

interface KeyRow {
  key_id: string
  user_id: string
  org_id: string
  scope: string
  allowed_space_ids: string[] | null
  allowed_actions: string[]
  space_id: string | null
}

const KEY_ROWS: Record<string, KeyRow> = {
  'key-alpha': {
    key_id: 'kid-alpha',
    user_id: 'user-alpha',
    org_id: 'org-alpha',
    scope: 'org',
    allowed_space_ids: null,
    allowed_actions: ['read', 'write'],
    space_id: null,
  },
  'key-beta': {
    key_id: 'kid-beta',
    user_id: 'user-beta',
    org_id: 'org-beta',
    scope: 'org',
    allowed_space_ids: null,
    allowed_actions: ['read'],
    space_id: null,
  },
}

vi.mock('./supabase/client.js', () => ({
  getSupabaseClient: () => ({
    rpc: async (_fn: string, args: { p_api_key: string }) => {
      const row = KEY_ROWS[args.p_api_key]
      return { data: row ? [row] : [], error: null }
    },
  }),
}))

/** ハンドラ内で解決を待たせるための関門。テスト側から任意の順で開ける */
function gate() {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

let handlerImpl: (params: unknown) => Promise<unknown> = async () => ({ ok: true })

vi.mock('./tools/index.js', () => ({
  allTools: [
    {
      name: 'fake_tool',
      inputSchema: { parse: (p: unknown) => p },
      handler: (p: unknown) => handlerImpl(p),
    },
  ],
}))

const { dispatchTool } = await import('./dispatch.js')
const { getAuthContext } = await import('./config.js')

beforeEach(() => {
  handlerImpl = async () => ({ ok: true })
})

describe('dispatchTool — 同時実行のテナント分離', () => {
  it('別の鍵の呼び出しが割り込んでも、各呼び出しは自分の組織を見続ける', async () => {
    const alphaEntered = gate()
    const alphaMayFinish = gate()

    // alpha は「入った」と知らせてから、テストが開けるまで待つ。
    // その間に beta が認証を走らせる（＝グローバルな置き場を書き換える）
    handlerImpl = async (params) => {
      const which = (params as { which: string }).which
      if (which === 'alpha') {
        alphaEntered.open()
        await alphaMayFinish.promise
      }
      // 待たされたあとに読み直しても、自分の組織でなければならない
      return { orgId: getAuthContext().orgId, userId: getAuthContext().userId }
    }

    const alpha = dispatchTool('key-alpha', 'fake_tool', { which: 'alpha' })
    await alphaEntered.promise

    const beta = await dispatchTool('key-beta', 'fake_tool', { which: 'beta' })
    alphaMayFinish.open()

    expect(beta).toEqual({ orgId: 'org-beta', userId: 'user-beta' })
    expect(await alpha).toEqual({ orgId: 'org-alpha', userId: 'user-alpha' })
  })

  it('先行する呼び出しが終わるのを待たずに、後続が完了できる（直列化していない）', async () => {
    const slowMayFinish = gate()
    const order: string[] = []

    handlerImpl = async (params) => {
      const which = (params as { which: string }).which
      if (which === 'slow') await slowMayFinish.promise
      order.push(which)
      return { which }
    }

    const slow = dispatchTool('key-alpha', 'fake_tool', { which: 'slow' })
    const fast = dispatchTool('key-beta', 'fake_tool', { which: 'fast' })

    // fast は slow の完了を待たずに返らなければならない
    await fast
    expect(order).toEqual(['fast'])

    slowMayFinish.open()
    await slow
    expect(order).toEqual(['fast', 'slow'])
  })

  it('認証に失敗した呼び出しは、他の呼び出しのコンテキストを壊さない', async () => {
    handlerImpl = async () => ({ orgId: getAuthContext().orgId })

    const bad = dispatchTool('key-unknown', 'fake_tool', {})
    await expect(bad).rejects.toThrow()

    const good = await dispatchTool('key-alpha', 'fake_tool', {})
    expect(good).toEqual({ orgId: 'org-alpha' })
  })

  /**
   * change_log トリガー向けの送信元区分（channel）も、他の認証情報と同じ ctx に載る。
   * getSupabaseClient()（supabase/client.ts）は ctx オブジェクトそのものを鍵に
   * ヘッダー入りクライアントを WeakMap で作り分けるため、割り込みで ctx が
   * すり替わらないこと・呼び出しごとに別オブジェクトであることの両方が安全の前提になる。
   */
  it('同時に割り込んでも channel は自分の呼び出しのものを見続け、ctx は呼び出しごとに別オブジェクト', async () => {
    const alphaEntered = gate()
    const alphaMayFinish = gate()
    const seenCtx: Record<string, unknown> = {}

    handlerImpl = async (params) => {
      const which = (params as { which: string }).which
      if (which === 'alpha') {
        alphaEntered.open()
        await alphaMayFinish.promise
      }
      seenCtx[which] = getAuthContext()
      return { channel: getAuthContext().channel }
    }

    const alpha = dispatchTool('key-alpha', 'fake_tool', { which: 'alpha' }, undefined, 'stdio')
    await alphaEntered.promise

    const beta = await dispatchTool('key-beta', 'fake_tool', { which: 'beta' }, undefined, 'mcp')
    alphaMayFinish.open()

    expect(beta).toEqual({ channel: 'mcp' })
    expect(await alpha).toEqual({ channel: 'stdio' })
    // 割り込みで同じ ctx オブジェクトを共有していたら、client.ts の WeakMap 分離が壊れる
    expect(seenCtx.alpha).not.toBe(seenCtx.beta)
  })
})
