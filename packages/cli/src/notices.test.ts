import { describe, it, expect, vi } from 'vitest'
import { pickUnseen, formatNotices, showNewNotices, type NoticeStore } from './notices.js'
import { validateManifest } from './manifest-validator.js'
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

describe('validateManifest: notices', () => {
  const base = { version: '0.0.0-builtin', minCliVersion: '0.1.0', generatedAt: '', checksum: '', commands: [] }

  it('形の正しいお知らせだけ残し、制御文字は落とす', () => {
    const m = validateManifest({
      ...base,
      notices: [
        { id: 'ok-1', date: '2026-09-07', message: 'よい\x1b[31mお知らせ' },
        { id: 'bad id with space', message: 'x' },
        { id: 'no-message' },
        { id: 'too-long', message: 'a'.repeat(1000) },
        'not-an-object',
      ],
    })
    expect(m.notices).toEqual([{ id: 'ok-1', date: '2026-09-07', message: 'よいお知らせ' }])
  })

  it('notices が無い・配列でない場合は空配列にする(旧サーバー互換)', () => {
    expect(validateManifest({ ...base }).notices).toEqual([])
    expect(validateManifest({ ...base, notices: 'x' }).notices).toEqual([])
  })
})
