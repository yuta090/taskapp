import { describe, it, expect } from 'vitest'
import { parseGenericInboundEvent } from '@/lib/connectors/genericPayload'

/**
 * 汎用Webhook受信のペイロード契約。
 *
 * これは顧客側の送信設定（Zapier等のマッピング）が依存する**外部仕様**なので、
 * ここのテストは「実装の説明」ではなく「壊してはいけない約束」を固定するもの。
 */

function body(over: Record<string, unknown> = {}) {
  return {
    event_id: 'evt-1',
    event_type: 'task.created',
    connection_id: 'conn-1',
    external_id: 'ext-1',
    title: '請求書を送る',
    ...over,
  }
}

describe('parseGenericInboundEvent — 受け取る形', () => {
  it('必須項目が揃っていれば正規化して返す', () => {
    const result = parseGenericInboundEvent(body({ body: 'メモ', due_date: '2026-07-31' }))
    expect(result).toEqual({
      ok: true,
      event: {
        eventId: 'evt-1',
        eventType: 'task.created',
        connectionId: 'conn-1',
        externalId: 'ext-1',
        title: '請求書を送る',
        body: 'メモ',
        clearBody: false,
        dueDate: '2026-07-31',
      },
    })
  })

  it('前後の空白は落とす（送信側のテンプレート由来の空白で別タスク扱いにしない）', () => {
    const result = parseGenericInboundEvent(body({ external_id: '  ext-1  ', title: ' 請求書 ' }))
    expect(result.ok && result.event.externalId).toBe('ext-1')
    expect(result.ok && result.event.title).toBe('請求書')
  })

  it('本文は「未指定」と「空にする」を区別する（外部で消したのに残り続けないように）', () => {
    const untouched = parseGenericInboundEvent(body())
    expect(untouched.ok && untouched.event.clearBody).toBe(false)
    const cleared = parseGenericInboundEvent(body({ body: null }))
    expect(cleared.ok && cleared.event.clearBody).toBe(true)
  })

  it('存在しない日付は拒否する（形式だけ合っている値をDBまで通すと500→再送ループになる）', () => {
    expect(parseGenericInboundEvent(body({ due_date: '2026-99-99' })).ok).toBe(false)
    expect(parseGenericInboundEvent(body({ due_date: '2026-02-30' })).ok).toBe(false)
    expect(parseGenericInboundEvent(body({ due_date: '2028-02-29' })).ok).toBe(true) // 閏年は有効
  })

  it('期日は省略できる（未指定と「期日なし」を区別する）', () => {
    const omitted = parseGenericInboundEvent(body())
    expect(omitted.ok && omitted.event.dueDate).toBeUndefined()
    const cleared = parseGenericInboundEvent(body({ due_date: null }))
    expect(cleared.ok && cleared.event.dueDate).toBeNull()
  })
})

describe('parseGenericInboundEvent — 受け取らない形（入口で理由を返す）', () => {
  it('JSONオブジェクトでなければ拒否', () => {
    for (const raw of [null, 'x', 42, ['a']]) {
      expect(parseGenericInboundEvent(raw).ok).toBe(false)
    }
  })

  it('冪等キー(event_id)が無ければ拒否（再送で二重起票になるため）', () => {
    const result = parseGenericInboundEvent(body({ event_id: undefined }))
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toContain('event_id')
  })

  it('未知の event_type は拒否（黙って無視すると送信側が気づけない）', () => {
    expect(parseGenericInboundEvent(body({ event_type: 'task.deleted' })).ok).toBe(false)
  })

  it('接続ID・外部IDが無ければ拒否', () => {
    expect(parseGenericInboundEvent(body({ connection_id: '' })).ok).toBe(false)
    expect(parseGenericInboundEvent(body({ external_id: undefined })).ok).toBe(false)
  })

  it('起票にタイトルが無ければ拒否（「(無題)」で埋めると後から何のタスクか分からない）', () => {
    expect(parseGenericInboundEvent(body({ title: undefined })).ok).toBe(false)
  })

  it('完了・更新はタイトル無しでもよい（外部側が差分しか送れないことがある）', () => {
    expect(parseGenericInboundEvent(body({ event_type: 'task.completed', title: undefined })).ok).toBe(true)
    expect(parseGenericInboundEvent(body({ event_type: 'task.updated', title: undefined })).ok).toBe(true)
  })

  it('期日は日付だけ受ける（日時を受けるとタイムゾーンで1日ずれる）', () => {
    expect(parseGenericInboundEvent(body({ due_date: '2026-07-31T00:00:00Z' })).ok).toBe(false)
    expect(parseGenericInboundEvent(body({ due_date: '2026/07/31' })).ok).toBe(false)
  })

  it('長すぎるフィールドは入口で切る（無制限に受けるとDBと通知の両方が壊れる）', () => {
    expect(parseGenericInboundEvent(body({ title: 'あ'.repeat(4001) })).ok).toBe(false)
    expect(parseGenericInboundEvent(body({ external_id: 'x'.repeat(256) })).ok).toBe(false)
  })
})
