import { describe, it, expect } from 'vitest'
import { sanitize, validateManifest, NOTICES_MAX } from './manifest-validator.js'

const ESC = '\x1b'

describe('sanitize(サーバーから来た表示文字列)', () => {
  it('ANSI の色指定は丸ごと消える(ESC だけ消えて "[31m" が残らない)', () => {
    expect(sanitize(`${ESC}[31mRED${ESC}[0m`)).toBe('RED')
  })
  it('画面切替(ESC [?1049h)・タイトル書き換え(OSC)も丸ごと消える', () => {
    expect(sanitize(`a${ESC}[?1049hb`)).toBe('ab')
    expect(sanitize(`a${ESC}]0;evil title\x07b`)).toBe('ab')
  })
  it('C0/C1 制御文字(8bit CSI 含む)と、表示方向を反転する文字を落とす', () => {
    expect(sanitize('a\x00b\x7fc\u009bd')).toBe('abcd')
    expect(sanitize('safe\u202Egpj.exe')).toBe('safegpj.exe')
    expect(sanitize('x\u2066y\u2069z')).toBe('xyz')
  })
  it('日本語・絵文字・改行以外の普通の文字はそのまま', () => {
    expect(sanitize('日本語 と 📣 と tab\tは消える')).toBe('日本語 と 📣 と tabは消える')
  })
})

describe('validateManifest: notices', () => {
  const base = { version: '0.0.0-builtin', minCliVersion: '0.1.0', generatedAt: '', checksum: '', commands: [] }

  it('形の正しいお知らせだけ残し、制御文字は落とす', () => {
    const m = validateManifest({
      ...base,
      notices: [
        { id: 'ok-1', date: '2026-09-07', message: `よい${ESC}[31mお知らせ` },
        { id: 'bad id with space', message: 'x' },
        { id: 'no-message' },
        { id: 'too-long', message: 'a'.repeat(1000) },
        { id: 'bad-date', date: '9/7', message: '日付は落ちるが本文は残る' },
        'not-an-object',
      ],
    })
    expect(m.notices).toEqual([
      { id: 'ok-1', date: '2026-09-07', message: 'よいお知らせ' },
      { id: 'bad-date', message: '日付は落ちるが本文は残る' },
    ])
  })

  it('notices が無い・配列でない場合は空配列にする(旧サーバー互換)', () => {
    expect(validateManifest({ ...base }).notices).toEqual([])
    expect(validateManifest({ ...base, notices: 'x' }).notices).toEqual([])
  })

  it('多すぎる場合は新しい方(末尾)だけ NOTICES_MAX 件受け取る(端末フラッド防止)', () => {
    const notices = Array.from({ length: 100 }, (_, i) => ({ id: `n-${i}`, message: `m${i}` }))
    const m = validateManifest({ ...base, notices })
    expect(m.notices).toHaveLength(NOTICES_MAX)
    expect(m.notices[0].id).toBe(`n-${100 - NOTICES_MAX}`)
    expect(m.notices[NOTICES_MAX - 1].id).toBe('n-99')
  })
})
