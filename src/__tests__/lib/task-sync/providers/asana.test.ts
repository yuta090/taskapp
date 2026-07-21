import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { asanaAdapter } from '@/lib/task-sync/providers/asana'
import type { ProviderContext } from '@/lib/task-sync/types'

/**
 * Asana アダプタ。
 *
 * Asana API (openapi.yaml, 2026-07-21 取得) の性質（アダプタが吸収する差異）:
 *   - ホストは固定（https://app.asana.com/api/1.0）。認証は個人アクセストークン(PAT)を
 *     `Authorization: Bearer` で渡す（`securitySchemes.personalAccessToken: {type: http, scheme: bearer}`）。
 *   - `GET /tasks` は `modified_since`（ISO8601 datetime）で絞れる＝秒粒度（cursorGranularity='timestamp'）。
 *   - ページングは `limit`(最大100) + 不透明 `offset`（レスポンスの `next_page.offset`）。
 *     `next_page` は limit 指定時のみ返る＝limit を必ず渡す。
 *   - 完了は `completed`(boolean) でテナント非依存＝Backlogのような上書き設定は不要。
 *   - 期日は `due_on`('YYYY-MM-DD' の日付のみ) と `due_at`(実時刻の ISO8601、両者は排他) の2種類。
 *     `due_on` はそのままローカル日付として使える。`due_at` は実時刻を持つため、素朴に先頭10文字を
 *     切ると UTC日付になり日本時間で1日ずれうる（CLAUDE.md 禁止事項そのもの）。よって `due_at` しか
 *     無い場合だけ Date を経由し `formatDateToLocalString` でローカル日付に変換する。
 *   - `GET /tasks` はプロジェクト等でスコープが必須で、`project` 指定時は workspace 不要だが、
 *     `GET /projects` 一覧はワークスペース(Organization)単位。PATは複数ワークスペースに跨りうるため、
 *     どのワークスペースを見るかは接続ごとに固定する必要があり `config.asana_workspace_gid` で受ける。
 *   - 削除: Asana の OpenAPI 定義には tombstone/is_deleted 相当のフィールドが存在しない（削除された
 *     タスクは `GET /tasks` の結果から単に消えるだけ）。ExternalTask.deleted は付与しない（未確認 →
 *     厳密には「削除の検知手段が無い」という設計上の制約。エンジン側で削除検知が要るなら別途
 *     全件突合が要る）。
 */

const BASE = 'https://app.asana.com/api/1.0'

function ctx(config?: Record<string, unknown>): ProviderContext {
  return { credentials: { kind: 'api_key', token: 'pat-secret' }, config }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function lastCall(): [string, RequestInit | undefined] {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return call as [string, RequestInit | undefined]
}

function lastUrl(): URL {
  return new URL(lastCall()[0])
}

describe('asanaAdapter — 宣言', () => {
  it('PAT認証・ベースURL不要・差分は秒粒度(timestamp)', () => {
    expect(asanaAdapter.id).toBe('asana')
    expect(asanaAdapter.authKind).toBe('api_key')
    expect(asanaAdapter.hostPolicy).toEqual({ kind: 'fixed', host: 'app.asana.com' })
    expect(asanaAdapter.cursorGranularity).toBe('timestamp')
    // tombstone/is_deleted相当が無く、削除タスクは一覧から単に消えるだけで判別できない。
    expect(asanaAdapter.deletionMode).toBe('unsupported')
  })
})

/**
 * セキュリティ/レート制限。トークンはヘッダに載るためURLに秘密は無いが、応答本文には
 * 顧客データが載り得るためログ・例外に出さない。429はAsanaの Retry-After(秒) を運ぶ。
 */
describe('asanaAdapter — セキュリティ/レート制限', () => {
  it('429はRetry-After(秒)をretryAfterMsとして載せる', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '30' }),
      json: async () => ({}),
      text: async () => '',
    } as Response)
    const err = await asanaAdapter.listChangedTasks(ctx(), '111', {}).catch((e) => e)
    expect(err.status).toBe(429)
    expect(err.retryAfterMs).toBe(30_000)
  })

  it('リダイレクトを自動追跡しない（転送先へAuthorizationヘッダを渡さない）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))
    await asanaAdapter.listContainers(ctx({ asana_workspace_gid: '999' }))
    const init = lastCall()[1]
    expect(init?.redirect).toBe('manual')
  })

  it('エラー時に応答本文をログへ出さない（本文に顧客データが含まれ得る）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(jsonResponse({ leaked: 'secret-project-data' }, 500))
    await expect(asanaAdapter.listChangedTasks(ctx(), '111', {})).rejects.toMatchObject({ status: 500 })
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('secret-project-data')
    }
    errorSpy.mockRestore()
  })
})

describe('asanaAdapter.listContainers', () => {
  it('config.asana_workspace_gid 配下のプロジェクトを id/title に正規化する', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          { gid: '111', name: 'アルファ案件', archived: false },
          { gid: '222', name: 'ベータ案件', archived: false },
        ],
      }),
    )
    const containers = await asanaAdapter.listContainers(ctx({ asana_workspace_gid: '999' }))
    expect(containers).toEqual([
      { id: '111', title: 'アルファ案件' },
      { id: '222', title: 'ベータ案件' },
    ])
  })

  it('PATをBearerヘッダで送り、workspace指定・archived=falseで /projects を叩く', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))
    await asanaAdapter.listContainers(ctx({ asana_workspace_gid: '999' }))
    const [url, init] = lastCall()
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe(`${BASE}/projects`)
    expect(u.searchParams.get('workspace')).toBe('999')
    expect(u.searchParams.get('archived')).toBe('false')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer pat-secret')
  })

  it('asana_workspace_gid が未設定の接続は配線ミス(permanent)として弾く', async () => {
    await expect(asanaAdapter.listContainers(ctx())).rejects.toMatchObject({
      permanent: true,
      status: 400,
    })
    await expect(asanaAdapter.listContainers(ctx())).rejects.toThrow(/asana_workspace_gid/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('asanaAdapter.listChangedTasks', () => {
  const task = {
    gid: '501',
    name: '契約書のドラフト',
    notes: '初稿を作る',
    due_on: '2026-07-31',
    due_at: null,
    completed: false,
    assignee: { gid: '55', resource_type: 'user' },
    modified_at: '2026-07-20T10:00:00.000Z',
  }

  it('タスクを ExternalTask に正規化する（due_on はそのままローカル日付）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [task], next_page: null }))
    const page = await asanaAdapter.listChangedTasks(ctx(), '111', {})
    expect(page.items).toEqual([
      {
        externalId: '501',
        containerId: '111',
        title: '契約書のドラフト',
        body: '初稿を作る',
        dueDate: '2026-07-31',
        completed: false,
        assigneeKey: '55',
        updatedAt: '2026-07-20T10:00:00.000Z',
      },
    ])
  })

  it('due_on が無く due_at のみの場合はローカル日付へ変換する(toISOStringは使わない)', async () => {
    // 2026-07-31T15:00:00Z は日本時間で 2026-08-01。素朴な UTC 切り出しだと 07-31 のまま
    // ずれてしまう事故を防げているかをここで検証する。
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ ...task, gid: '502', due_on: null, due_at: '2026-07-31T15:00:00.000Z' }],
        next_page: null,
      }),
    )
    const page = await asanaAdapter.listChangedTasks(ctx(), '111', {})
    expect(page.items[0].dueDate).toBe('2026-08-01')
  })

  it('期日・本文・担当者が無いタスクも落とさず null に正規化する', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ gid: '503', name: '電話する', notes: null, due_on: null, due_at: null, completed: false }],
        next_page: null,
      }),
    )
    const page = await asanaAdapter.listChangedTasks(ctx(), '111', {})
    expect(page.items[0]).toMatchObject({ dueDate: null, body: null, assigneeKey: null })
  })

  it('project・modified_since・limitをクエリに載せる', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [], next_page: null }))
    await asanaAdapter.listChangedTasks(ctx(), '111', { since: '2026-07-19T00:00:00.000Z' })
    const url = lastUrl()
    expect(url.origin + url.pathname).toBe(`${BASE}/tasks`)
    expect(url.searchParams.get('project')).toBe('111')
    expect(url.searchParams.get('modified_since')).toBe('2026-07-19T00:00:00.000Z')
    expect(url.searchParams.get('limit')).toBe('100')
  })

  it('next_page があれば offset をカーソルとして返し、次回はそれを offset に渡す', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [task], next_page: { offset: 'opaque-token-1' } }),
    )
    const first = await asanaAdapter.listChangedTasks(ctx(), '111', {})
    expect(first.nextCursor).toBe('opaque-token-1')

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [], next_page: null }))
    const second = await asanaAdapter.listChangedTasks(ctx(), '111', { cursor: 'opaque-token-1' })
    expect(lastUrl().searchParams.get('offset')).toBe('opaque-token-1')
    expect(second.nextCursor).toBeNull()
  })

  it('APIエラーは status を載せた例外にする', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'not found' }] }, 404))
    await expect(asanaAdapter.listChangedTasks(ctx(), '111', {})).rejects.toMatchObject({ status: 404 })
  })
})

describe('asanaAdapter.completeTask', () => {
  it('PUT /tasks/{gid} に completed:true をJSONで送る', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { gid: '501', completed: true } }))
    await asanaAdapter.completeTask(ctx(), { externalId: '501', containerId: '111' })

    const [url, init] = lastCall()
    expect(new URL(url).pathname).toBe('/api/1.0/tasks/501')
    expect(init?.method).toBe('PUT')
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer pat-secret')
    expect(JSON.parse(String(init?.body))).toEqual({ data: { completed: true } })
  })

  it('404(既に消えている)も status を保って投げる', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [] }, 404))
    await expect(
      asanaAdapter.completeTask(ctx(), { externalId: '999', containerId: '111' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
