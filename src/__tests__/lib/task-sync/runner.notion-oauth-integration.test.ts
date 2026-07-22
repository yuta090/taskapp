import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * runner.ts（cronの入口）から実物の resolveCredentials・実物のエンジン(engine.ts)・実物の
 * notionAdapter まで、実際に配線が繋がっていることを固定する結合テスト。
 *
 * 背景（本丸の回帰）: credentials.ts の resolveCredentials は auth_kind==='oauth' のとき
 * refreshFn が無いと misconfigured を返していたが、runner.ts は resolveCredentials(conn) を
 * refreshFn 無しで呼んでいた。Notion は既存アダプタで初の authKind:'oauth'（他は全て api_key）
 * であり、かつ Notion のトークンは無期限で refresh_token が存在しない。この2つが組み合わさると、
 * **Notion 接続は毎回 misconfigured で skip され、取り込みが一度も実行されない**という断線になる。
 *
 * この結合テストは credentials.ts と runner.ts の**両方を実物のまま**（token-crypto の
 * decryptToken だけをスタブして暗号化の実配線を避ける）通し、engine.ts / providers/notion.ts も
 * 実物のまま fetch だけをモックすることで、runner が実際に Notion API へ到達するところまで
 * 証明する。credentials.ts 単体のユニットテスト（credentials.test.ts）だけでは、runner.ts が
 * 実際に refreshFn 無しで resolveCredentials を呼んでいるという配線自体は検証できないため、
 * この結合テストが無いと同じ断線を再発させる。
 */

const connectionRows: unknown[] = []
const validateImportTargets = vi.fn()
const decryptToken = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: connectionRows, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        let claimedId = ''
        const step: Record<string, unknown> = {
          eq: (col: string, value: string) => {
            if (col === 'id') claimedId = value
            return step
          },
          is: () => step,
          select: async () => {
            void payload
            return { data: [{ id: claimedId }], error: null }
          },
        }
        return step
      },
    }),
  }),
}))

// resolveCredentials/runner はそのまま実物を使う。復号(token-crypto)だけをスタブして
// SYSTEM_ENCRYPTION_KEY・実DBのRPCに依存しないようにする（credentials.test.ts と同じ流儀）。
vi.mock('@/lib/integrations/token-crypto', () => ({
  decryptToken: (...args: unknown[]) => decryptToken(...args),
}))

// エンジン・アダプタ登録表は実物を使う。store.ts だけは DB 実装を避けるためモックする
// （エンジンの制御ロジック自体は engine.test.ts が別途固定しているため、ここでの関心は
// 「runner→credentials→engine→adapter」の配線が繋がっているか、に絞る）。
vi.mock('@/lib/task-sync/store', () => ({
  createTaskSyncStore: () => ({
    loadLinks: async () => new Map(),
    createLinkedTask: async () => 'task-1',
    updateLinkedTask: async () => {},
    completeLinkedTask: async () => true,
    markLinkOrphaned: async () => {},
    saveCursor: async () => {},
  }),
  validateImportTargets: (...args: unknown[]) => validateImportTargets(...args),
}))

const { runTaskSyncImport } = await import('@/lib/task-sync/runner')

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as Response
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'conn-notion-1',
    org_id: 'org-1',
    provider: 'notion',
    auth_kind: 'oauth',
    base_url: null,
    access_token_encrypted: 'enc-access-token',
    // 更新不能なOAuth接続（Notion）: refresh_token 系は無い。
    refresh_token_encrypted: null,
    refresh_token: null,
    import_config: {
      target_space_id: 'space-1',
      // notion_mappings は provider 接頭辞(notion_)が付くため ctx.config へそのまま渡る。
      notion_mappings: {
        'db-1': { due_prop_id: null, status: null, confirmed_at: '2026-01-01T00:00:00.000Z' },
      },
    },
    poll_cursor: null,
    last_import_success_at: null,
    last_poll_attempt_at: null,
    ...over,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  connectionRows.length = 0
  validateImportTargets.mockReset().mockResolvedValue({ ok: true, assigneeId: null })
  decryptToken.mockReset().mockResolvedValue('notion-workspace-token')
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runTaskSyncImport — Notion(oauth・refresh_token無し)が実際にアダプタ呼び出しへ到達する', () => {
  it('misconfigured skip にならず、resolveCredentials で復号したトークンで実際に Notion API(listContainers) まで到達する', async () => {
    // listContainers: POST /v1/search — 対象コンテナ db-1 を1件返す。
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ results: [{ id: 'db-1', title: [{ plain_text: 'タスクDB' }] }], next_cursor: null, has_more: false }),
    )
    // listChangedTasks 初回ページ: 実行時スキーマdrift再検証(GET /v1/databases/db-1)。
    // マッピングは due_prop_id/status ともに null なので、ライブスキーマが空でも検証は通る。
    fetchMock.mockResolvedValueOnce(jsonResponse({ properties: {} }))
    // 続いて databases.query。対象0件で完走させる。
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [], next_cursor: null, has_more: false }))

    connectionRows.push(row())
    const summary = await runTaskSyncImport()

    // 断線していた場合はここで skipped:1・reasons=['notion: credentials_misconfigured'] になり、
    // fetch は一度も呼ばれない。
    expect(summary.skipped).toBe(0)
    expect(summary.connections).toBe(1)

    // 実際に Notion API (listContainers→drift再検証→query) まで到達したことを fetch 呼び出しで確認する。
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const urls = fetchMock.mock.calls.map((c) => new URL(String(c[0])).pathname)
    expect(urls).toEqual(['/v1/search', '/v1/databases/db-1', '/v1/databases/db-1/query'])

    // resolveCredentials が復号したトークンがそのまま Authorization ヘッダに使われている
    // （runner→credentials→engine→adapter の配線が実際に繋がっている証拠）。
    const [, searchInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((searchInit.headers as Record<string, string>).Authorization).toBe('Bearer notion-workspace-token')

    expect(decryptToken).toHaveBeenCalledWith('enc-access-token')
  })

  it('復号できない(access_token_encrypted欠落等)の設定不備は、依然としてfetchせずskipする', async () => {
    // 上のテストとの対比: 「更新不能なOAuthだから常にfetchまで進む」わけではなく、実際に
    // 復号できないケースは従来どおり misconfigured skip のまま（毒にしない）ことを確認する。
    connectionRows.push(row({ access_token_encrypted: null }))
    decryptToken.mockResolvedValue(null)
    const summary = await runTaskSyncImport()
    expect(summary.skipped).toBe(1)
    expect(summary.reasons[0]).toContain('credentials_misconfigured')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
