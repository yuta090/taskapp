/**
 * データの取り置き（react-query）。前回読んだ一覧を端末に保存し、次に開いたときは
 * まずそれを出してから裏で新しくする（起動直後に空の画面・くるくるを出さない）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { QueryClient } from '@tanstack/react-query'

export { AAL_QUERY_KEY, shouldPersistQuery } from '~/lib/persistPolicy'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24,
      retry: 1,
    },
  },
})

export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'agentpm-query-cache',
})

/** ログアウトしたら、前の人のデータを端末から消す */
export async function clearCachedData(): Promise<void> {
  queryClient.clear()
  await persister.removeClient()
}
