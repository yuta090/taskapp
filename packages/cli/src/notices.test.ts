import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, readdirSync, statSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  pickUnseen, formatNotices, showNewNotices, shouldShowNotices, createFileNoticeStore, firstCommandName, MAX_SHOWN,
  type NoticeStore,
} from './notices.js'
import type { ManifestNotice } from './manifest-validator.js'

/**
 * サーバーのコマンド一覧(manifest)に添えられた「お知らせ」を、
 * まだ見ていない分だけ 1 回表示し、見た分は覚えておく。
 */
const N1: ManifestNotice = { id: '2026-09-07-file-upload', date: '2026-09-07', message: 'ファイルをCLIから上げられます' }
const N2: ManifestNotice = { id: '2026-09-07-file-jp-name', date: '2026-09-07', message: '日本語名のファイルも上げられます' }
const N3: ManifestNotice = { id: '2026-09-01-old', date: '2026-09-01', message: '古いお知らせ' }

function memoryStore(initial: string[] = []): NoticeStore & { seen: string[] } {
  const s = { seen: [...initial] } as NoticeStore & { seen: string[] }
  s.readSeen = () => s.seen
  s.writeSeen = (ids: string[]) => { s.seen = ids }
  return s
}

describe('pickUnseen', () => {
  it('見ていないものだけを日付順(古い→新しい)で返す', () => {
    expect(pickUnseen([N1, N2, N3], ['2026-09-07-file-upload'])).toEqual([N3, N2])
  })
  it('全部見ていれば空', () => {
    expect(pickUnseen([N1, N2], [N1.id, N2.id])).toEqual([])
  })
  it('お知らせが無ければ空', () => {
    expect(pickUnseen(undefined, [])).toEqual([])
  })
})

describe('formatNotices', () => {
  it('見出しと、日付付きの箇条書きになる', () => {
    const text = formatNotices([N3, N2])
    expect(text).toContain('お知らせ')
    expect(text).toContain('[2026-09-01] 古いお知らせ')
    expect(text).toContain('[2026-09-07] 日本語名のファイルも上げられます')
  })
})

describe('showNewNotices', () => {
  it('初回(記録なし)は全部表示し、表示した id を記録する', () => {
    const store = memoryStore()
    const print = vi.fn()
    const shown = showNewNotices({ notices: [N1, N2] }, { store, print })
    expect(shown).toBe(2)
    expect(print).toHaveBeenCalledTimes(1)
    expect(print.mock.calls[0][0]).toContain('日本語名')
    expect(store.seen).toEqual(expect.arrayContaining([N1.id, N2.id]))
  })

  it('2回目は何も出さない(記録済み)', () => {
    const store = memoryStore([N1.id, N2.id])
    const print = vi.fn()
    expect(showNewNotices({ notices: [N1, N2] }, { store, print })).toBe(0)
    expect(print).not.toHaveBeenCalled()
  })

  it('新しいお知らせが増えたら、その分だけ出す', () => {
    const store = memoryStore([N1.id])
    const print = vi.fn()
    expect(showNewNotices({ notices: [N1, N2] }, { store, print })).toBe(1)
    expect(print.mock.calls[0][0]).not.toContain('ファイルをCLIから')
    expect(print.mock.calls[0][0]).toContain('日本語名')
  })

  it('記録の読み書きに失敗しても落ちない(表示はする)', () => {
    const store: NoticeStore = {
      readSeen: () => { throw new Error('disk') },
      writeSeen: () => { throw new Error('disk') },
    }
    const print = vi.fn()
    expect(showNewNotices({ notices: [N1] }, { store, print })).toBe(1)
  })
})

describe('showNewNotices: 件数上限と重複', () => {
  const many: ManifestNotice[] = Array.from({ length: 8 }, (_, i) => ({
    id: `n-${i}`, date: `2026-09-${String(i + 1).padStart(2, '0')}`, message: `お知らせ${i}`,
  }))

  it('一度に出すのは新しい方から MAX_SHOWN 件。残りは「ほか N 件」にまとめ、全部既読にする', () => {
    const store = memoryStore()
    const print = vi.fn()
    expect(showNewNotices({ notices: many }, { store, print })).toBe(MAX_SHOWN)
    const text = print.mock.calls[0][0] as string
    expect(text).toContain('お知らせ7')
    expect(text).toContain('お知らせ3')
    expect(text).not.toContain('お知らせ2')
    expect(text).toContain(`ほか ${8 - MAX_SHOWN} 件`)
    expect(store.seen).toHaveLength(8)
    // 2回目は何も出ない(古い分も既読になっている)
    expect(showNewNotices({ notices: many }, { store, print })).toBe(0)
  })

  it('同じ id が重複して届いても 1 回だけ出し、既読も 1 つ', () => {
    const store = memoryStore()
    const print = vi.fn()
    expect(showNewNotices({ notices: [N1, N1] }, { store, print })).toBe(1)
    expect(store.seen).toEqual([N1.id])
  })

  it('既読の記録は重複を潰す(サーバーが同じ id を返し続けても既読枠を食わない)', () => {
    const store = memoryStore([N1.id, N1.id])
    showNewNotices({ notices: [N1, N2] }, { store, print: vi.fn() })
    expect(store.seen).toEqual([N1.id, N2.id])
  })
})

describe('shouldShowNotices', () => {
  it('端末につながっていて --json でないときだけ出す', () => {
    expect(shouldShowNotices(['node', 'agentpm', 'task', 'list'], true)).toBe(true)
    expect(shouldShowNotices(['node', 'agentpm', 'task', 'list', '--json'], true)).toBe(false)
    // cron や 2>/dev/null: 見えないので出さない(=既読にもならない)
    expect(shouldShowNotices(['node', 'agentpm', 'task', 'list'], false)).toBe(false)
  })
})

describe('createFileNoticeStore(実ディスク)', () => {
  function tempStore() {
    const dir = mkdtempSync(join(tmpdir(), 'agentpm-notices-'))
    const path = join(dir, 'sub', 'notices.seen.json')
    return { dir, path, store: createFileNoticeStore(path) }
  }

  it('ファイルが無ければ [] を返す', () => {
    const { dir, store } = tempStore()
    expect(store.readSeen()).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })

  it('書いて読める。パーミッションは 0600 で、.tmp は残らない', () => {
    const { dir, path, store } = tempStore()
    store.writeSeen(['a', 'b'])
    expect(store.readSeen()).toEqual(['a', 'b'])
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readdirSync(join(dir, 'sub')).filter((f) => f.endsWith('.tmp'))).toEqual([])
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(['a', 'b'])
    rmSync(dir, { recursive: true, force: true })
  })

  it('中身が配列でなければ [] 、文字列以外の要素は捨てる', () => {
    const { dir, path, store } = tempStore()
    store.writeSeen([])
    writeFileSync(path, JSON.stringify({ x: 1 }))
    expect(store.readSeen()).toEqual([])
    writeFileSync(path, JSON.stringify(['a', 1, null, 'b']))
    expect(store.readSeen()).toEqual(['a', 'b'])
    rmSync(dir, { recursive: true, force: true })
  })

  it('壊れた JSON は例外になり、showNewNotices は全件未読として表示する(落ちない)', () => {
    const { dir, path, store } = tempStore()
    store.writeSeen([])
    writeFileSync(path, '{not json')
    expect(() => store.readSeen()).toThrow()
    const print = vi.fn()
    expect(showNewNotices({ notices: [N1] }, { store, print })).toBe(1)
    // 表示後は正しい記録に直っている
    expect(store.readSeen()).toEqual([N1.id])
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('firstCommandName', () => {
  it('グローバルオプションを前に置いてもコマンド名を取れる', () => {
    expect(firstCommandName(['node', 'agentpm', 'update'])).toBe('update')
    expect(firstCommandName(['node', 'agentpm', '-s', 'uuid-1', 'update'])).toBe('update')
    expect(firstCommandName(['node', 'agentpm', '--json', '--api-key', 'k', 'task', 'list'])).toBe('task')
    expect(firstCommandName(['node', 'agentpm', '--help'])).toBeUndefined()
    expect(firstCommandName(['node', 'agentpm'])).toBeUndefined()
  })
})
