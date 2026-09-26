import { describe, it, expect } from 'vitest'
import {
  parseChangeLogFilters,
  opLabel,
  channelLabel,
  actorKindLabel,
  rowIdOf,
  CHANGE_LOG_PAGE_LIMIT,
} from '@/lib/change-log/adminFilters'

const UUID = '00000000-0000-4000-8000-00000000aaaa'

describe('parseChangeLogFilters — 運営画面の絞り込み（URL の ?…）を読む', () => {
  it('何も無ければ絞り込みなし', () => {
    expect(parseChangeLogFilters({})).toEqual({})
  })

  it('表・行・人・組織・経路・操作を受け取る', () => {
    expect(
      parseChangeLogFilters({
        table: 'wiki_pages',
        row: UUID,
        actor: UUID,
        org: UUID,
        channel: 'cli',
        op: 'D',
      }),
    ).toEqual({ table: 'wiki_pages', rowId: UUID, actorId: UUID, orgId: UUID, channel: 'cli', op: 'D' })
  })

  it('形のおかしい値は捨てる（表名は英小文字と _ だけ・ID は UUID・経路と操作は決まった値だけ）', () => {
    expect(
      parseChangeLogFilters({
        table: 'wiki_pages; drop',
        row: 'not-a-uuid',
        actor: '123',
        org: '',
        channel: 'evil',
        op: 'X',
      }),
    ).toEqual({})
  })

  it('日付（YYYY-MM-DD）は日本時間のその日の始まりと終わりにする', () => {
    expect(parseChangeLogFilters({ from: '2026-09-26', to: '2026-09-26' })).toEqual({
      from: '2026-09-26T00:00:00+09:00',
      to: '2026-09-26T23:59:59.999+09:00',
    })
    expect(parseChangeLogFilters({ from: '2026/09/26' })).toEqual({})
  })

  it('同じキーが複数あれば最初の値を使う', () => {
    expect(parseChangeLogFilters({ op: ['U', 'D'] })).toEqual({ op: 'U' })
  })
})

describe('表示の言葉', () => {
  it('操作: I/U/D → 追加/更新/削除', () => {
    expect([opLabel('I'), opLabel('U'), opLabel('D')]).toEqual(['追加', '更新', '削除'])
  })

  it('経路: 決まった値は日本語、知らない値はそのまま', () => {
    expect(channelLabel('app')).toBe('画面')
    expect(channelLabel('cli')).toBe('CLI')
    expect(channelLabel('mcp')).toBe('外部チャット(MCP)')
    expect(channelLabel('unattributed')).toBe('不明（サーバー）')
    expect(channelLabel('something')).toBe('something')
  })

  it('行為者の種類', () => {
    expect(actorKindLabel('user')).toBe('本人')
    expect(actorKindLabel('api_key')).toBe('APIキー')
    expect(actorKindLabel('service')).toBe('サーバー')
    expect(actorKindLabel('system')).toBe('システム')
  })

  it('行の ID: id があればそれ、複合キーは値を / でつなぐ', () => {
    expect(rowIdOf({ id: UUID })).toBe(UUID)
    expect(rowIdOf({ org_id: 'o1', key: 'invite' })).toBe('o1 / invite')
    expect(rowIdOf(null)).toBe('-')
  })

  it('1ページの件数は 100', () => {
    expect(CHANGE_LOG_PAGE_LIMIT).toBe(100)
  })
})
