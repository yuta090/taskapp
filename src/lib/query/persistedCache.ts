import { del, keys } from 'idb-keyval'

/**
 * IndexedDB に永続化する react-query キャッシュのキー接頭辞。QueryProvider.tsx が
 * `${IDB_KEY_PREFIX}:${userId}` の形でユーザー毎に分けて保存する。
 *
 * QueryProvider.tsx から切り出しているのは、signOutClient.ts（サインアウト失敗時でも
 * IDB を必ず消すため）からも参照する必要があるため — QueryProvider.tsx は既に
 * `isSignOutInProgress`（signOutClient.ts）を import しているので、QueryProvider.tsx
 * 側に置いたままだと signOutClient → QueryProvider → signOutClient の循環importになる。
 */
export const IDB_KEY_PREFIX = 'taskapp-query-cache'

/** Clear all persisted query caches (call on logout / user switch). Matches
 *  both scoped (`taskapp-query-cache:<uid>`) and the legacy unscoped key. */
export async function clearQueryCache() {
  const allKeys = await keys()
  const cacheKeys = allKeys.filter(
    (k) => typeof k === 'string' && k.startsWith(IDB_KEY_PREFIX)
  )
  await Promise.all(cacheKeys.map((k) => del(k)))
}
