import { describe, it, expect } from 'vitest'
import {
  MAX_AVATAR_BYTES,
  ACCEPTED_AVATAR_MIME,
  validateAvatarFile,
  avatarExt,
  buildAvatarPath,
  parseAvatarObjectPath,
} from '@/lib/avatar/avatarUpload'

// 最小の File 代替（jsdom の File でもよいが、size/type だけ使うので軽量スタブ）
function fakeFile(type: string, size: number, name = 'x'): File {
  return { type, size, name } as unknown as File
}

describe('validateAvatarFile', () => {
  it('画像でサイズ内なら ok', () => {
    expect(validateAvatarFile(fakeFile('image/png', 1000)).ok).toBe(true)
    expect(validateAvatarFile(fakeFile('image/jpeg', MAX_AVATAR_BYTES)).ok).toBe(true)
  })
  it('画像以外は拒否', () => {
    const r = validateAvatarFile(fakeFile('application/pdf', 100))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/画像/)
  })
  it('サイズ超過は拒否', () => {
    const r = validateAvatarFile(fakeFile('image/png', MAX_AVATAR_BYTES + 1))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/2MB|サイズ/)
  })
  it('受理MIMEは image/* の代表的な形式のみ', () => {
    expect(ACCEPTED_AVATAR_MIME).toContain('image/png')
    expect(validateAvatarFile(fakeFile('image/svg+xml', 100)).ok).toBe(false) // svgはXSS懸念で除外
  })
})

describe('avatarExt', () => {
  it('MIMEから拡張子を導く', () => {
    expect(avatarExt(fakeFile('image/jpeg', 1))).toBe('jpg')
    expect(avatarExt(fakeFile('image/png', 1))).toBe('png')
    expect(avatarExt(fakeFile('image/webp', 1))).toBe('webp')
    expect(avatarExt(fakeFile('image/gif', 1))).toBe('gif')
  })
})

describe('buildAvatarPath', () => {
  it('{userId}/{unique}.{ext} 形式（先頭フォルダが uid = RLSの本人判定）', () => {
    const p = buildAvatarPath('user-123', fakeFile('image/png', 1), 1730000000000)
    expect(p).toBe('user-123/1730000000000.png')
    expect(p.split('/')[0]).toBe('user-123')
  })
})

describe('parseAvatarObjectPath', () => {
  it('公開URLから storage オブジェクトパス（uid/ファイル名）を取り出す', () => {
    const url = 'https://x.supabase.co/storage/v1/object/public/avatars/user-1/1730.png'
    expect(parseAvatarObjectPath(url)).toBe('user-1/1730.png')
  })
  it('クエリ(キャッシュバスター)付きでも取り出せる', () => {
    const url = 'https://x.supabase.co/storage/v1/object/public/avatars/user-1/1730.png?t=999'
    expect(parseAvatarObjectPath(url)).toBe('user-1/1730.png')
  })
  it('avatars バケット以外/別ドメインは null（削除対象にしない）', () => {
    expect(parseAvatarObjectPath('https://example.com/some/other.png')).toBeNull()
    expect(parseAvatarObjectPath(null)).toBeNull()
    expect(parseAvatarObjectPath('')).toBeNull()
  })
})
