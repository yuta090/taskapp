import { describe, it, expect } from 'vitest'
import { toStorageKeyName, isStorageSafeKeyName } from '@/lib/files/storageKey'

/**
 * 日本語名のファイルを Storage に置くと InvalidKey で失敗する不具合の回帰テスト。
 * 表示名はそのまま、鍵に使う名前だけ英数字に落とす。
 */
describe('toStorageKeyName', () => {
  it('英数字だけの名前はそのまま', () => {
    expect(toStorageKeyName('list.csv')).toBe('list.csv')
    expect(toStorageKeyName('my-file_v2.PDF')).toBe('my-file_v2.PDF')
  })

  it('日本語・全角記号・空白は "_" にまとめ、拡張子は残す', () => {
    expect(toStorageKeyName('議事録.pdf')).toBe('file.pdf')
    expect(toStorageKeyName('DXセミナー＞研修販売に向けたタスク - No.5_標準機能一覧_20260904.csv')).toBe(
      'DX_-_No.5_20260904.csv',
    )
  })

  it('拡張子がない・先頭ドットだけの名前も鍵になる', () => {
    expect(toStorageKeyName('README')).toBe('README')
    expect(toStorageKeyName('資料')).toBe('file')
    expect(toStorageKeyName('.env')).toBe('.env')
  })

  it('# ? などURLで壊れる文字も "_" になる', () => {
    expect(toStorageKeyName('a#b?c.txt')).toBe('a_b_c.txt')
  })

  it('長い名前は本体を100文字に切る', () => {
    const long = 'a'.repeat(300) + '.csv'
    expect(toStorageKeyName(long)).toBe('a'.repeat(100) + '.csv')
  })

  it('変換後は必ず鍵として安全な文字だけになる', () => {
    for (const n of ['議事録.pdf', '＞＞＞', '  ', 'a b.c d', 'x'.repeat(500)]) {
      expect(isStorageSafeKeyName(toStorageKeyName(n))).toBe(true)
    }
  })
})
