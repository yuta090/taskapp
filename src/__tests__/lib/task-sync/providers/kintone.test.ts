import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { kintoneAdapter } from '@/lib/task-sync/providers/kintone'
import type { ProviderContext } from '@/lib/task-sync/types'
import type { KintoneMapping } from '@/lib/task-sync/providers/kintone/mapping'

/**
 * kintone アダプタ — inbound（取り込み）＋ 完了の書き戻しのみ（createTask/updateTask は未実装）。
 * 各エンドポイントの形は cybozu developer network / kintone.dev の公開ドキュメントで確認済み
 * （src/lib/task-sync/providers/kintone.ts 冒頭コメント参照）。
 */

const BASE_URL = 'https://foo.cybozu.com'
const TOKEN = 'api-token-1'

function ctx(config?: Record<string, unknown>, baseUrl: string | null = BASE_URL): ProviderContext {
  return { credentials: { kind: 'api_key', token: TOKEN, baseUrl }, config }
}

function statusMapping(overrides: Partial<NonNullable<KintoneMapping['status']>> = {}): KintoneMapping['status'] {
  return {
    field_code: 'status',
    field_type: 'DROP_DOWN',
    done_values: ['完了'],
    // write_done_action は field_type==='STATUS' のときだけ設定できる契約(mapping.tsのコメント
    // 参照)。デフォルトの field_type='DROP_DOWN'(DEFAULT_LIVE_FIELDS/kintoneRecord()の既定と揃えて
    // 読み取り系テストをそのまま通す)と両立させるため、既定は null(検知のみ・書き戻し不可)にする。
    // 書き戻し(completeTask)を実際に検証するテストは writableStatusMapping() を使う。
    write_done_action: null,
    ...overrides,
  }
}

/** completeTask(書き戻し)の happy path を検証するテスト専用: STATUS型+write_done_action設定済み。 */
function writableStatusMapping(
  overrides: Partial<NonNullable<KintoneMapping['status']>> = {},
): KintoneMapping['status'] {
  return statusMapping({ field_type: 'STATUS', write_done_action: '完了にする', ...overrides })
}

function mapping(overrides: Partial<KintoneMapping> = {}): KintoneMapping {
  return {
    title_field_code: 'title',
    due_field_code: 'due',
    status: statusMapping(),
    confirmed_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

function mappingConfig(m: KintoneMapping, appId = '5'): Record<string, unknown> {
  return { kintone_mappings: { [appId]: m } }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
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

function calls(): [string, RequestInit][] {
  return fetchMock.mock.calls as [string, RequestInit][]
}

/** ポーリング初回ページ(cursor未指定)が呼ぶ GET fields.json への応答。 */
function fieldsResponse(
  entries: Array<{ code: string; type: string; label?: string; options?: string[] }>,
): Response {
  const properties: Record<string, unknown> = {}
  for (const e of entries) {
    properties[e.code] = {
      code: e.code,
      label: e.label ?? e.code,
      type: e.type,
      required: false,
      ...(e.options ? { options: Object.fromEntries(e.options.map((o, i) => [o, { label: o, index: String(i) }])) } : {}),
    }
  }
  return jsonResponse({ properties, revision: '1' })
}

const DEFAULT_LIVE_FIELDS = [
  { code: 'title', type: 'SINGLE_LINE_TEXT' },
  { code: 'due', type: 'DATE' },
  { code: 'status', type: 'DROP_DOWN', options: ['未着手', '進行中', '完了'] },
  { code: 'Updated_datetime', type: 'UPDATED_TIME' },
]

function kintoneRecord(overrides: Record<string, { type: string; value: unknown }> = {}) {
  return {
    $id: { type: '__ID__', value: '100' },
    $revision: { type: '__REVISION__', value: '3' },
    Updated_datetime: { type: 'UPDATED_TIME', value: '2026-07-01T01:00:00Z' },
    title: { type: 'SINGLE_LINE_TEXT', value: 'サンプルタスク' },
    due: { type: 'DATE', value: '2026-07-15' },
    status: { type: 'DROP_DOWN', value: '未着手' },
    ...overrides,
  }
}

describe('kintoneAdapter — 宣言', () => {
  it('authKind/hostPolicy/cursorGranularity/deletionModeを宣言する', () => {
    expect(kintoneAdapter.id).toBe('kintone')
    expect(kintoneAdapter.authKind).toBe('api_key')
    expect(kintoneAdapter.hostPolicy).toEqual({
      kind: 'vendor-domain',
      allowedSuffixes: ['.cybozu.com', '.kintone.com'],
    })
    expect(kintoneAdapter.cursorGranularity).toBe('timestamp')
    expect(kintoneAdapter.deletionMode).toBe('unsupported')
  })
})

describe('kintoneAdapter.listContainers', () => {
  it('設定済みのアプリID(kintone_app_ids)ごとにGET app.jsonを叩き、成功したものだけ返す', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ appId: '5', name: 'タスク管理' }))
      .mockResolvedValueOnce(jsonResponse({ appId: '9', name: '案件管理' }))
    const result = await kintoneAdapter.listContainers(ctx({ kintone_app_ids: ['5', '9'] }))
    expect(result).toEqual([
      { id: '5', title: 'タスク管理' },
      { id: '9', title: '案件管理' },
    ])
  })

  it('403/404のアプリ(トークン無効/剥奪)は返さない', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ appId: '5', name: 'タスク管理' }))
      .mockResolvedValueOnce(jsonResponse({ code: 'CB_NO02', message: 'no permission' }, 403))
    const result = await kintoneAdapter.listContainers(ctx({ kintone_app_ids: ['5', '9'] }))
    expect(result).toEqual([{ id: '5', title: 'タスク管理' }])
  })

  it('403/404以外の失敗(ネットワーク断等)は伝播させる', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 500))
    await expect(kintoneAdapter.listContainers(ctx({ kintone_app_ids: ['5'] }))).rejects.toMatchObject({
      status: 500,
    })
  })

  it('kintone_app_idsが未設定/不正なら空配列を返す(fetchしない)', async () => {
    const result = await kintoneAdapter.listContainers(ctx({}))
    expect(result).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('kintoneAdapter.listChangedTasks', () => {
  /**
   * ⚠ 「未マッピング(設定途中の正常な状態)」と「マッピングが壊れている(異常)」の区別
   * （Codexレビュー指摘: 是正前はどちらも同列のpermanentエラーで、エンジン側が接続全体を
   * 止めていた）。kintone_mappingsにappIdのエントリ自体が無い(=まだウィザードを完了していない)
   * 場合だけ pendingConfig:true を立てる。エンジン(engine.ts)はこのフラグを見て、この
   * コンテナだけを対象から外し、他のコンテナの取り込みは続行する。
   */
  it('マッピングのエントリ自体が無いアプリ(未設定)はpendingConfig:trueで区別してfetchする前に止める', async () => {
    await expect(kintoneAdapter.listChangedTasks(ctx({}), '5', {})).rejects.toMatchObject({
      permanent: true,
      status: 400,
      pendingConfig: true,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('kintone_mappingsに他アプリのエントリはあるが、このappId自体のエントリが無い場合もpendingConfig:trueになる', async () => {
    await expect(
      kintoneAdapter.listChangedTasks(ctx({ kintone_mappings: { '9': mapping() } }), '5', {}),
    ).rejects.toMatchObject({ permanent: true, status: 400, pendingConfig: true })
  })

  it('エントリはあるが値が不正(壊れている)なアプリは、未設定とは区別しpendingConfigを立てずに止める', async () => {
    // confirmed_at が不正な形式＝parseKintoneMappingが拒否する壊れたデータ。
    // 「まだ設定していない」のではなく異常な状態なので、エンジンはこのコンテナだけを
    // 対象から外さず接続全体を止める（従来どおり）。
    let caught: unknown
    try {
      await kintoneAdapter.listChangedTasks(
        ctx({ kintone_mappings: { '5': { ...mapping(), confirmed_at: 'not-a-date' } } }),
        '5',
        {},
      )
    } catch (err) {
      caught = err
    }
    expect(caught).toMatchObject({ permanent: true, status: 400 })
    expect((caught as { pendingConfig?: boolean }).pendingConfig).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cursor未指定(初回ページ)はfields.jsonでdrift検証してからrecords.jsonを叩く', async () => {
    fetchMock.mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS)).mockResolvedValueOnce(
      jsonResponse({ records: [kintoneRecord()] }),
    )
    const result = await kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})
    expect(calls()[0][0]).toContain('/k/v1/app/form/fields.json')
    expect(calls()[1][0]).toContain('/k/v1/records.json')
    expect(result.items).toEqual([
      {
        externalId: '100',
        containerId: '5',
        title: 'サンプルタスク',
        body: null,
        dueDate: '2026-07-15',
        completed: false,
        updatedAt: '2026-07-01T01:00:00Z',
      },
    ])
    expect(result.nextCursor).toBeNull()
  })

  it('マッピングとライブスキーマが食い違ったら再マッピングを促す恒久エラーで停止する', async () => {
    fetchMock.mockResolvedValueOnce(
      fieldsResponse([
        { code: 'title', type: 'SINGLE_LINE_TEXT' },
        { code: 'due', type: 'SINGLE_LINE_TEXT' }, // DATE型のはずが変更されている
        { code: 'status', type: 'DROP_DOWN', options: ['完了'] },
        { code: 'Updated_datetime', type: 'UPDATED_TIME' },
      ]),
    )
    await expect(kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})).rejects.toMatchObject({
      permanent: true,
      status: 400,
    })
    // records.json へは進まない
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sinceありの差分取得はUPDATED_TIME型フィールドで絞り込むqueryを組み立てる(固定名で決め打ちしない)', async () => {
    fetchMock
      .mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS))
      .mockResolvedValueOnce(jsonResponse({ records: [] }))
    await kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', { since: '2026-07-01T00:00:00Z' })
    const url = new URL(calls()[1][0])
    const query = url.searchParams.get('query') ?? ''
    expect(query).toContain('Updated_datetime > "2026-07-01T00:00:00Z"')
    expect(query).toContain('order by Updated_datetime asc')
  })

  it('sinceなし(初回全件)は$id昇順でページングする', async () => {
    fetchMock
      .mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS))
      .mockResolvedValueOnce(jsonResponse({ records: [] }))
    await kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})
    const url = new URL(calls()[1][0])
    expect(url.searchParams.get('query')).toContain('order by $id asc')
  })

  it('sinceがあるのにUPDATED_TIME型フィールドが見つからないなら恒久エラーで止める', async () => {
    fetchMock.mockResolvedValueOnce(
      fieldsResponse([
        { code: 'title', type: 'SINGLE_LINE_TEXT' },
        { code: 'due', type: 'DATE' },
        { code: 'status', type: 'DROP_DOWN', options: ['完了'] },
      ]),
    )
    await expect(
      kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', { since: '2026-07-01T00:00:00Z' }),
    ).rejects.toMatchObject({ permanent: true })
  })

  it('2ページ目以降はfields.jsonを叩き直さず、cursorに埋め込んだ更新日時フィールドコードを使う', async () => {
    fetchMock.mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS)).mockResolvedValueOnce(
      jsonResponse({
        records: Array.from({ length: 500 }, (_, i) => kintoneRecord({ $id: { type: '__ID__', value: String(i) } })),
        totalCount: '600', // 500件ちょうど返ってきたが、totalCountで「まだ続きがある」と分かる
      }),
    )
    const page1 = await kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {
      since: '2026-07-01T00:00:00Z',
    })
    expect(page1.nextCursor).not.toBeNull()

    fetchMock.mockResolvedValueOnce(jsonResponse({ records: [] }))
    await kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {
      since: '2026-07-01T00:00:00Z',
      cursor: page1.nextCursor!,
    })
    // 2ページ目はfields.jsonを叩かず、records.jsonだけを叩く(合計3回=1回目schema+1回目records+2回目records)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const url = new URL(calls()[2][0])
    expect(url.searchParams.get('query')).toContain('Updated_datetime >')
    expect(url.searchParams.get('query')).toContain('offset 500')
  })

  it('sinceありの差分取得は$idを第2ソートキーに含める(同一更新日時の取りこぼし防止)', async () => {
    fetchMock
      .mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS))
      .mockResolvedValueOnce(jsonResponse({ records: [] }))
    await kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', { since: '2026-07-01T00:00:00Z' })
    const url = new URL(calls()[1][0])
    expect(url.searchParams.get('query')).toContain('order by Updated_datetime asc, $id asc')
  })

  it('records.jsonの取得は毎回totalCount=trueを付ける(次ページの有無をpage size頼みにしない)', async () => {
    fetchMock
      .mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS))
      .mockResolvedValueOnce(jsonResponse({ records: [], totalCount: '0' }))
    await kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})
    const url = new URL(calls()[1][0])
    expect(url.searchParams.get('totalCount')).toBe('true')
  })

  it('offset上限(10000)を超えたら恒久エラーで停止する(黙って打ち切らない)', async () => {
    const corruptedButValidCursor = JSON.stringify({ offset: 10_001, updatedFieldCode: null })
    await expect(
      kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', { cursor: corruptedButValidCursor }),
    ).rejects.toMatchObject({ permanent: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('不正な内部カーソルはpermanentエラーにする(データ破損)', async () => {
    await expect(
      kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', { cursor: 'not-json' }),
    ).rejects.toMatchObject({ permanent: true })
  })

  it('レコードが500件ちょうど(PAGE_SIZE)でも、totalCountがまだ先にあるならnextCursorを返す', async () => {
    fetchMock.mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS)).mockResolvedValueOnce(
      jsonResponse({
        records: Array.from({ length: 500 }, (_, i) => kintoneRecord({ $id: { type: '__ID__', value: String(i) } })),
        totalCount: '600',
      }),
    )
    const result = await kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})
    expect(result.nextCursor).not.toBeNull()
  })

  /**
   * 境界のバグ修正本体: 「500件返ってきたら次ページがある」という決め打ちだけだと、ちょうど
   * 500件が実は全件(totalCount===fetchedSoFar)の偽陽性ケースで誤って次ページを要求してしまう
   * (offset方式の上限直前でこれが起きると、次のoffsetが上限を超えて必ず失敗し続ける)。
   * totalCountで「本当に続きがあるか」を判定することでこれを塞ぐ。
   */
  describe('境界: totalCountに基づく完走判定(records.length===PAGE_SIZEが実は終端のケース)', () => {
    it('総件数がちょうど500(PAGE_SIZE)＝1ページ目がそのまま終端ならnextCursor=nullで正常終了する', async () => {
      fetchMock.mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS)).mockResolvedValueOnce(
        jsonResponse({
          records: Array.from({ length: 500 }, (_, i) => kintoneRecord({ $id: { type: '__ID__', value: String(i) } })),
          totalCount: '500', // ちょうど500件返ってきたが、それが全件(偽陽性ケース)
        }),
      )
      const result = await kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})
      expect(result.nextCursor).toBeNull()
      // 誤って次ページを要求していないことも合わせて確認(fetchは2回のみ=schema+records)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('総件数がちょうど10,000(offset上限と同値)なら、offset上限に到達しても正常に完走する', async () => {
      // 1ページ目: offset=0で500件(まだ続きがある)
      fetchMock
        .mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS))
        .mockResolvedValueOnce(
          jsonResponse({
            records: Array.from({ length: 500 }, (_, i) => kintoneRecord({ $id: { type: '__ID__', value: String(i) } })),
            totalCount: '10000',
          }),
        )
      const page1 = await kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})
      expect(page1.nextCursor).not.toBeNull()

      // 最終ページ(offset=9500)がちょうどlimit件(500件)で、かつそれが本当の終端(9500+500=10000=totalCount)。
      const lastPageCursor = JSON.stringify({ offset: 9_500, updatedFieldCode: null })
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          records: Array.from({ length: 500 }, (_, i) => kintoneRecord({ $id: { type: '__ID__', value: String(9_500 + i) } })),
          totalCount: '10000',
        }),
      )
      const lastPage = await kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {
        cursor: lastPageCursor,
      })
      expect(lastPage.nextCursor).toBeNull()
      const url = new URL(calls()[2][0])
      expect(url.searchParams.get('query')).toContain('offset 9500')
    })

    it('総件数がちょうど10,500(offset上限+PAGE_SIZE)なら、offset=10000の最終ページで正常に完走する', async () => {
      // offset=10000は許容される上限ちょうどの値。ここで残り500件(合計10500件)を取り切れる。
      const cursorAtLimit = JSON.stringify({ offset: 10_000, updatedFieldCode: null })
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          records: Array.from({ length: 500 }, (_, i) => kintoneRecord({ $id: { type: '__ID__', value: String(10_000 + i) } })),
          totalCount: '10500',
        }),
      )
      const result = await kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {
        cursor: cursorAtLimit,
      })
      expect(result.nextCursor).toBeNull()
    })

    it('総件数が10,500を超える(offset方式の到達可能範囲を超える)なら、黙って打ち切らず恒久エラーにする', async () => {
      // offset=10000のページがちょうど500件返ってきて、かつtotalCountがそれでもまだ先にある
      // (10501件以上)。次に必要なoffset(10500)は上限(10000)を超えるため、offset方式では
      // 原理的に取り切れない。無限リトライさせず、ここで明示的に停止する。
      const cursorAtLimit = JSON.stringify({ offset: 10_000, updatedFieldCode: null })
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          records: Array.from({ length: 500 }, (_, i) => kintoneRecord({ $id: { type: '__ID__', value: String(10_000 + i) } })),
          totalCount: '10501',
        }),
      )
      await expect(
        kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', { cursor: cursorAtLimit }),
      ).rejects.toMatchObject({ permanent: true, status: 400 })
    })

    it('totalCountが応答に無い/数値化できない(totalCount=trueを指定したのに欠落)場合はエラーにする(無言で握り潰さない)', async () => {
      fetchMock.mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS)).mockResolvedValueOnce(
        jsonResponse({
          records: Array.from({ length: 500 }, (_, i) => kintoneRecord({ $id: { type: '__ID__', value: String(i) } })),
          // totalCount 欠落
        }),
      )
      await expect(kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})).rejects.toThrow()
    })
  })

  it('期日フィールドの値がnullなら正常に期日なしとして扱う', async () => {
    fetchMock
      .mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS))
      .mockResolvedValueOnce(
        jsonResponse({ records: [kintoneRecord({ due: { type: 'DATE', value: null } })] }),
      )
    const result = await kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})
    expect(result.items[0].dueDate).toBeNull()
  })

  it('期日フィールドがレコード応答に存在しない場合は無言でnullにせずエラーにする', async () => {
    fetchMock.mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS)).mockResolvedValueOnce(
      jsonResponse({ records: [kintoneRecord({ due: undefined as never })] }),
    )
    await expect(kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})).rejects.toThrow()
  })

  it('期日フィールドの型がDATEでない場合はエラーにする', async () => {
    fetchMock
      .mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS))
      .mockResolvedValueOnce(
        jsonResponse({ records: [kintoneRecord({ due: { type: 'SINGLE_LINE_TEXT', value: 'oops' } })] }),
      )
    await expect(kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})).rejects.toThrow()
  })

  /**
   * 暦日不正の回帰テスト固定(本番事故歴があるため必須。CLAUDE.md/課題スペック参照)。
   * kintoneのDATE型は既にローカル日付'YYYY-MM-DD'そのもの(公式: Field Types の Date)だが、
   * 実在しない暦日(2月30日等)・月/日が範囲外・日時形式混入は「無言でそのまま通す」でも
   * 「無言でnullに倒す」でもなく、エラーとして顕在化させる(resolveDueDateの信頼境界)。
   */
  describe('期日フィールドの暦日不正(2026-02-30等)', () => {
    it('存在しない暦日(2026-02-30)はエラーにする', async () => {
      fetchMock
        .mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS))
        .mockResolvedValueOnce(jsonResponse({ records: [kintoneRecord({ due: { type: 'DATE', value: '2026-02-30' } })] }))
      await expect(kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})).rejects.toThrow()
    })

    it('月が範囲外(2026-13-01)はエラーにする', async () => {
      fetchMock
        .mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS))
        .mockResolvedValueOnce(jsonResponse({ records: [kintoneRecord({ due: { type: 'DATE', value: '2026-13-01' } })] }))
      await expect(kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})).rejects.toThrow()
    })

    it('日が範囲外(2026-04-31。4月は30日まで)はエラーにする', async () => {
      fetchMock
        .mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS))
        .mockResolvedValueOnce(jsonResponse({ records: [kintoneRecord({ due: { type: 'DATE', value: '2026-04-31' } })] }))
      await expect(kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})).rejects.toThrow()
    })

    it('日時形式(時刻付き)が混入した値はエラーにする(kintoneのDATE型は年月日のみのはず)', async () => {
      fetchMock
        .mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS))
        .mockResolvedValueOnce(
          jsonResponse({ records: [kintoneRecord({ due: { type: 'DATE', value: '2026-07-15T00:00:00Z' } })] }),
        )
      await expect(kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})).rejects.toThrow()
    })
  })

  it('DROP_DOWNのvalueがdone_valuesに含まれればcompleted=trueにする', async () => {
    fetchMock
      .mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS))
      .mockResolvedValueOnce(
        jsonResponse({ records: [kintoneRecord({ status: { type: 'DROP_DOWN', value: '完了' } })] }),
      )
    const result = await kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})
    expect(result.items[0].completed).toBe(true)
  })

  it('CHECK_BOX型は値配列とdone_valuesの積が非空ならcompleted=trueにする', async () => {
    const m = mapping({ status: statusMapping({ field_code: 'flags', field_type: 'CHECK_BOX', done_values: ['完了'] }) })
    fetchMock
      .mockResolvedValueOnce(
        fieldsResponse([
          ...DEFAULT_LIVE_FIELDS,
          { code: 'flags', type: 'CHECK_BOX', options: ['完了', '要確認'] },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          records: [kintoneRecord({ flags: { type: 'CHECK_BOX', value: ['完了', '要確認'] } })],
        }),
      )
    const result = await kintoneAdapter.listChangedTasks(ctx(mappingConfig(m)), '5', {})
    expect(result.items[0].completed).toBe(true)
  })

  it('未選択(DROP_DOWNのvalue=null)は正常にcompleted=falseとして扱う', async () => {
    fetchMock
      .mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS))
      .mockResolvedValueOnce(jsonResponse({ records: [kintoneRecord({ status: { type: 'DROP_DOWN', value: null } })] }))
    const result = await kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})
    expect(result.items[0].completed).toBe(false)
  })

  it('statusフィールドの型が想定と食い違う場合はエラーにする', async () => {
    fetchMock
      .mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS))
      .mockResolvedValueOnce(
        jsonResponse({ records: [kintoneRecord({ status: { type: 'RADIO_BUTTON', value: '完了' } })] }),
      )
    await expect(kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})).rejects.toThrow()
  })

  it('タイトルフィールドが空文字なら「(無題)」にフォールバックする', async () => {
    fetchMock
      .mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS))
      .mockResolvedValueOnce(jsonResponse({ records: [kintoneRecord({ title: { type: 'SINGLE_LINE_TEXT', value: '' } })] }))
    const result = await kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})
    expect(result.items[0].title).toBe('(無題)')
  })

  it('$idが応答に無ければ応答不整合としてエラーにする', async () => {
    fetchMock
      .mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS))
      .mockResolvedValueOnce(jsonResponse({ records: [kintoneRecord({ $id: undefined as never })] }))
    await expect(kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})).rejects.toThrow()
  })
})

describe('kintoneAdapter.completeTask', () => {
  it('マッピング自体が無ければpermanentエラー', async () => {
    await expect(kintoneAdapter.completeTask(ctx({}), { externalId: '100', containerId: '5' })).rejects.toMatchObject(
      { permanent: true, status: 400 },
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('status:null(完了同期なし)ならpermanentエラー', async () => {
    await expect(
      kintoneAdapter.completeTask(ctx(mappingConfig(mapping({ status: null }))), {
        externalId: '100',
        containerId: '5',
      }),
    ).rejects.toMatchObject({ permanent: true, status: 400 })
  })

  it('write_done_actionが未設定(検知のみ)ならpermanentエラー(取り込み自体は止めない設計)', async () => {
    const m = mapping({ status: statusMapping({ write_done_action: null }) })
    await expect(
      kintoneAdapter.completeTask(ctx(mappingConfig(m)), { externalId: '100', containerId: '5' }),
    ).rejects.toMatchObject({ permanent: true, status: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('DROP_DOWN等(STATUS型以外)は書き戻し不可の設定として理由付きpermanentエラーにする(完了が永久に定着しないのを防ぐ)', async () => {
    // 通常はparseKintoneMapping/validateMappingAgainstSchemaがSTATUS型以外へのwrite_done_action
    // 設定を拒否するため、ここではmapping()ヘルパーで直接オブジェクトを構築し(parseを経由しない)
    // 「制約導入前の既存データ」を模したケースとしてcompleteTask側の名指しメッセージを固定する。
    const m = mapping({
      status: statusMapping({ field_type: 'DROP_DOWN', write_done_action: null }),
    })
    const err = await kintoneAdapter
      .completeTask(ctx(mappingConfig(m)), { externalId: '100', containerId: '5' })
      .catch((e) => e)
    expect(err.permanent).toBe(true)
    expect(err.status).toBe(400)
    expect(err.message).toContain('対応していません')
    expect(err.message).toContain('プロセス管理')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('revisionを取得してからUpdate Status APIをrevision付きで呼ぶ(楽観ロック)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ record: { $revision: { type: '__REVISION__', value: '7' } } }))
      .mockResolvedValueOnce(jsonResponse({ revision: '9' }))
    const m = mapping({ status: writableStatusMapping() })
    await kintoneAdapter.completeTask(ctx(mappingConfig(m)), { externalId: '100', containerId: '5' })

    expect(calls()[0][0]).toContain('/k/v1/record.json')
    const [statusUrl, statusInit] = calls()[1]
    expect(statusUrl).toContain('/k/v1/record/status.json')
    expect(statusInit.method).toBe('PUT')
    const body = JSON.parse(String(statusInit.body))
    expect(body).toEqual({ app: 5, id: 100, action: '完了にする', revision: 7 })
  })

  it('404は例外のstatusを保つ(呼び出し側が「既に消えている」を握れるように)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'not found' }, 404))
    const m = mapping({ status: writableStatusMapping() })
    await expect(
      kintoneAdapter.completeTask(ctx(mappingConfig(m)), { externalId: 'ghost', containerId: '5' }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('権限不足(GAIA_NO01)は名指しした恒久エラーにする。listChangedTasksは道連れにしない(取り込み全体は殺さない)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ record: { $revision: { type: '__REVISION__', value: '1' } } }))
      .mockResolvedValueOnce(
        jsonResponse({ code: 'GAIA_NO01', message: '(管理者の表示言語設定に従うため日本語のこともある)' }, 403),
      )
    const err = await kintoneAdapter
      .completeTask(ctx(mappingConfig(mapping({ status: writableStatusMapping() }))), {
        externalId: '100',
        containerId: '5',
      })
      .catch((e) => e)
    expect(err.permanent).toBe(true)
    expect(err.message).toContain('アクセス権')

    // completeTaskの権限不足はこの呼び出しだけの失敗であり、別の接続操作(listChangedTasks)には
    // 一切影響しない(状態を共有しない独立した呼び出しのため、道連れにして止まらないことを固定する)。
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(fieldsResponse(DEFAULT_LIVE_FIELDS)).mockResolvedValueOnce(
      jsonResponse({ records: [kintoneRecord()] }),
    )
    const result = await kintoneAdapter.listChangedTasks(ctx(mappingConfig(mapping())), '5', {})
    expect(result.items).toHaveLength(1)
  })
})

describe('kintoneAdapter — アプリを更新(反映)漏れ・トークン誤り検知(codeベース判定)', () => {
  // ⚠ ここでは listChangedTasks(初回ページのfields.json取得)を使って分類を検証する。
  // listContainers は本ファイル冒頭の別テスト群が固定する通り「403/404は当該アプリを
  // 静かにスキップする」という別目的の設計(トークンが無効/剥奪なアプリ一部を全体停止させない)を
  // 持ち、その skip 判定は raw な HTTP status だけを見る(code分類とは独立)。そのため
  // 同じ403でも listContainers 経由だと「エラーとして呼び出し元に伝播したか」を観測できない
  // (スキップされて空配列が返るだけになる)。classify のロジック自体は kintoneFetch を経由する
  // 全呼び出しで共通なので、常に伝播する呼び出し(listChangedTasks/completeTask)で検証する。
  it('GAIA_IA02(アプリを更新漏れ)は行動を名指ししたpermanentエラーにする', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'GAIA_IA02', message: 'irrelevant english text' }, 520))
    const err = await kintoneAdapter
      .listChangedTasks(ctx(mappingConfig(mapping())), '5', {})
      .then(() => null, (e) => e)
    expect(err?.permanent).toBe(true)
    expect(err?.message).toContain('アプリを更新')
  })

  it('GAIA_IA02は message が日本語(kintone管理者の表示言語が日本語)でもcodeだけで判定できる(本丸: 言語非依存)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'GAIA_IA02', message: '指定されたAPIトークンは、アプリで生成されたAPIトークンと一致しません。' }, 520),
    )
    const err = await kintoneAdapter
      .listChangedTasks(ctx(mappingConfig(mapping())), '5', {})
      .then(() => null, (e) => e)
    expect(err?.permanent).toBe(true)
    expect(err?.message).toContain('アプリを更新')
  })

  it('GAIA_AP15(アプリとトークンの組み合わせ誤り)は組み合わせ誤りを名指ししたpermanentエラーにする', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'GAIA_AP15', message: 'irrelevant' }, 403))
    const err = await kintoneAdapter
      .listChangedTasks(ctx(mappingConfig(mapping())), '5', {})
      .then(() => null, (e) => e)
    expect(err?.permanent).toBe(true)
    expect(err?.message).toContain('アプリIDとAPIトークンの組み合わせ')
  })

  it('GAIA_AP15とGAIA_IA02は異なるメッセージに区別される', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'GAIA_AP15' }, 403))
    const wrongAppErr = await kintoneAdapter
      .listChangedTasks(ctx(mappingConfig(mapping())), '5', {})
      .then(() => null, (e) => e)

    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'GAIA_IA02' }, 520))
    const notDeployedErr = await kintoneAdapter
      .listChangedTasks(ctx(mappingConfig(mapping())), '5', {})
      .then(() => null, (e) => e)

    expect(wrongAppErr?.message).toBeTruthy()
    expect(notDeployedErr?.message).toBeTruthy()
    expect(wrongAppErr?.message).not.toEqual(notDeployedErr?.message)
  })

  it('GAIA_UN03(同時編集競合)はpermanentにならず一時失敗として扱う', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ record: { $revision: { type: '__REVISION__', value: '1' } } }))
      .mockResolvedValueOnce(jsonResponse({ code: 'GAIA_UN03', message: 'conflict' }, 409))
    const err = await kintoneAdapter
      .completeTask(ctx(mappingConfig(mapping({ status: writableStatusMapping() }))), {
        externalId: '100',
        containerId: '5',
      })
      .catch((e) => e)
    expect(err.permanent).toBeFalsy()
  })

  it('未知のcode・codeが無い応答でも、認証系ステータス(401/403/520)なら3候補を列挙するフォールバックにする(落ちない・誤断定しない)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'GAIA_UNKNOWN_FUTURE_CODE', message: 'x' }, 403))
    const err1 = await kintoneAdapter
      .listChangedTasks(ctx(mappingConfig(mapping())), '5', {})
      .then(() => null, (e) => e)
    expect(err1?.permanent).toBe(true)
    expect(err1?.message).toContain('アプリを更新')
    expect(err1?.message).toContain('権限')
    expect(err1?.message).toContain('このアプリのものか')

    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401)) // codeが全く無い応答
    const err2 = await kintoneAdapter
      .listChangedTasks(ctx(mappingConfig(mapping())), '5', {})
      .then(() => null, (e) => e)
    expect(err2?.permanent).toBe(true)
    expect(err2?.message).toContain('アプリを更新')
  })

  it('認証系ステータス以外(500等)で未知/欠落codeなら、フォールバック案内を付けず従来通りの汎用エラーのままにする', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'internal error' }, 500))
    const err = await kintoneAdapter
      .listChangedTasks(ctx(mappingConfig(mapping())), '5', {})
      .then(() => null, (e) => e)
    expect(err?.message).not.toContain('アプリを更新')
    expect(err?.status).toBe(500)
  })

  it('listContainersの403/404スキップは既存通り維持される(未分類の一時的なトークン無効/剥奪をコンテナ単位で読み飛ばす設計は変えない)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ appId: '5', name: 'タスク管理' }))
      .mockResolvedValueOnce(jsonResponse({ code: 'GAIA_AP15', message: 'irrelevant' }, 403))
    const result = await kintoneAdapter.listContainers(ctx({ kintone_app_ids: ['5', '9'] }))
    expect(result).toEqual([{ id: '5', title: 'タスク管理' }])
  })

  it('APIトークンが10個以上(上限超過)は設定不備として恒久エラーにする', async () => {
    const manyTokens = Array.from({ length: 10 }, (_, i) => `t${i}`).join(',')
    await expect(
      kintoneAdapter.listContainers({ credentials: { kind: 'api_key', token: manyTokens, baseUrl: BASE_URL }, config: { kintone_app_ids: ['5'] } }),
    ).rejects.toMatchObject({ permanent: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('正規ドメイン以外のbaseUrlは拒否する(vendor-domainのドット境界一致)', async () => {
    await expect(
      kintoneAdapter.listContainers(ctx({ kintone_app_ids: ['5'] }, 'https://evil.example.com')),
    ).rejects.toMatchObject({ permanent: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
