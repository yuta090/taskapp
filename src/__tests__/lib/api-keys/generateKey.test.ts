// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'

/**
 * APIキーは、画面（ブラウザ）ではなくサーバー側で、推測できない乱数から作る。
 * 乱数源は node:crypto の randomInt（暗号学的乱数から一様分布の整数を返す）に固定していて、
 * 外から差し替える手段は無い。文字集合の大きさをそのまま上限として渡すことで、
 * 剰余演算（% 文字数）による偏りも避けている。
 *
 * node:crypto を見張るこのテストは jsdom 環境だと別ファイル（generateKey.ts）越しの
 * モックが効かない（Vite が jsdom 環境では node の組み込みモジュールを importer ごとに
 * 別インスタンス化してしまう）ため、このファイルだけ node 環境に切り替えている。
 */

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return { ...actual, randomInt: vi.fn(actual.randomInt) }
})

const { randomInt } = await import('node:crypto')
const { generateApiKey } = await import('@/lib/api-keys/generateKey')

const randomIntMock = randomInt as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  randomIntMock.mockClear()
})

describe('generateApiKey', () => {
  it('tsk_ に続けて英数字32文字のキーを作る', () => {
    const { key } = generateApiKey()
    expect(key).toMatch(/^tsk_[A-Za-z0-9]{32}$/)
  })

  it('呼び出すたびに違うキーを作る', () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateApiKey().key))
    expect(keys.size).toBe(200)
  })

  it('node:crypto の randomInt を、文字集合の大きさ(62)を上限にして32回呼ぶ（剰余による偏りを避ける）', () => {
    generateApiKey()

    expect(randomIntMock).toHaveBeenCalledTimes(32)
    for (const call of randomIntMock.mock.calls) {
      expect(call[0]).toBe(62) // A-Z, a-z, 0-9
    }
  })

  it('randomInt が返しうる値(0〜61)は、62種類の文字すべてに対応する', () => {
    let n = 0
    randomIntMock.mockImplementation(() => (n++) % 62)

    // 1回32文字なので、2回分（64回のrandomInt呼び出し）で0〜61を1周以上カバーする
    const body1 = generateApiKey().key.slice('tsk_'.length)
    const body2 = generateApiKey().key.slice('tsk_'.length)
    const chars = new Set((body1 + body2).split(''))

    expect(chars.size).toBe(62)
  })

  it('保存用のハッシュは、返した平文キーの SHA-256(hex) と一致する', () => {
    const { key, keyHash } = generateApiKey()
    expect(keyHash).toBe(createHash('sha256').update(key).digest('hex'))
  })

  it('一覧表示用の prefix は平文キーの先頭部分だけを含み、平文そのものではない', () => {
    const { key, keyPrefix } = generateApiKey()
    expect(keyPrefix.startsWith(key.slice(0, 12))).toBe(true)
    expect(keyPrefix).not.toBe(key)
  })
})
