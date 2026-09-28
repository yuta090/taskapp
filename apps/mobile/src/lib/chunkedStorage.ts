/**
 * ログイン情報（Supabase のセッション）を端末の安全な保管場所（SecureStore）に入れるための包み。
 *
 * SecureStore は1か所に入れる値が大きいと失敗する（目安 2KB）。セッションはトークンと
 * ユーザー情報を含んで 2KB を超えることがあるので、決まった大きさに分けて保存する。
 *   <key>.n = 断片の数 / <key>.0, <key>.1, … = 断片
 * 断片が1つでも欠けていたら、壊れたトークンを渡さないよう「無い」ことにする（ログインし直し）。
 */

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

/** SecureStore のキーに使えるのは英数字と . - _ だけ */
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_')
}

export function createChunkedStorage(store: KeyValueStore, chunkSize = 1800): KeyValueStore {
  async function readCount(base: string): Promise<number> {
    const raw = await store.getItem(`${base}.n`)
    const n = raw === null ? 0 : Number(raw)
    return Number.isInteger(n) && n > 0 ? n : 0
  }

  async function removeChunks(base: string, from: number, to: number): Promise<void> {
    for (let i = from; i < to; i++) await store.removeItem(`${base}.${i}`)
  }

  return {
    async getItem(key) {
      const base = safeKey(key)
      const count = await readCount(base)
      if (count === 0) return null
      const parts: string[] = []
      for (let i = 0; i < count; i++) {
        const part = await store.getItem(`${base}.${i}`)
        if (part === null) return null
        parts.push(part)
      }
      return parts.join('')
    },

    async setItem(key, value) {
      const base = safeKey(key)
      const previous = await readCount(base)
      const parts: string[] = []
      for (let i = 0; i < value.length; i += chunkSize) parts.push(value.slice(i, i + chunkSize))
      if (parts.length === 0) parts.push('')
      for (let i = 0; i < parts.length; i++) await store.setItem(`${base}.${i}`, parts[i])
      await store.setItem(`${base}.n`, String(parts.length))
      await removeChunks(base, parts.length, previous)
    },

    async removeItem(key) {
      const base = safeKey(key)
      const count = await readCount(base)
      await store.removeItem(`${base}.n`)
      await removeChunks(base, 0, count)
    },
  }
}
