import { describe, expect, it } from 'vitest'
import { createChunkedStorage, type KeyValueStore } from './chunkedStorage'

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      data.set(k, v)
    },
    removeItem: async (k) => {
      data.delete(k)
    },
  }
}

describe('createChunkedStorage', () => {
  it('書いたものをそのまま読める', async () => {
    const store = memoryStore()
    const storage = createChunkedStorage(store, 4)
    await storage.setItem('sb-auth', 'abcdefghij')
    expect(await storage.getItem('sb-auth')).toBe('abcdefghij')
  })

  it('1か所に入れる大きさを超える値は分けて保存する', async () => {
    const store = memoryStore()
    const storage = createChunkedStorage(store, 4)
    await storage.setItem('sb-auth', 'abcdefghij')
    for (const v of store.data.values()) expect(v.length).toBeLessThanOrEqual(4)
    expect(store.data.size).toBeGreaterThan(2)
  })

  it('短い値で上書きしたら、前の余った断片を残さない', async () => {
    const store = memoryStore()
    const storage = createChunkedStorage(store, 4)
    await storage.setItem('sb-auth', 'abcdefghijklmnop')
    await storage.setItem('sb-auth', 'xy')
    expect(await storage.getItem('sb-auth')).toBe('xy')
    expect([...store.data.keys()].filter((k) => k.startsWith('sb-auth'))).toHaveLength(2)
  })

  it('消したら読めなくなり、断片も残らない', async () => {
    const store = memoryStore()
    const storage = createChunkedStorage(store, 4)
    await storage.setItem('sb-auth', 'abcdefghij')
    await storage.removeItem('sb-auth')
    expect(await storage.getItem('sb-auth')).toBeNull()
    expect(store.data.size).toBe(0)
  })

  it('無いキーは null', async () => {
    const storage = createChunkedStorage(memoryStore(), 4)
    expect(await storage.getItem('missing')).toBeNull()
  })

  it('断片が欠けていたら（途中で書き込みが止まったなど）壊れた値を返さず null', async () => {
    const store = memoryStore()
    const storage = createChunkedStorage(store, 4)
    await storage.setItem('sb-auth', 'abcdefghij')
    store.data.delete('sb-auth.1')
    expect(await storage.getItem('sb-auth')).toBeNull()
  })

  it('キーに使えない文字は置き換える（SecureStore は英数字と . - _ だけ）', async () => {
    const store = memoryStore()
    const storage = createChunkedStorage(store, 4)
    await storage.setItem('sb:auth/token', 'v')
    for (const k of store.data.keys()) expect(k).toMatch(/^[A-Za-z0-9._-]+$/)
    expect(await storage.getItem('sb:auth/token')).toBe('v')
  })
})
