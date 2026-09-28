/**
 * データの取り置き（react-query）。前回読んだ一覧を端末に保存し、次に開いたときは
 * まずそれを出してから裏で新しくする（起動直後に空の画面・くるくるを出さない）。
 *
 * 端末に取り置く先（AsyncStorage）は暗号化されないので、トークンなど秘密はキーにも値にも入れない。
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { focusManager, QueryClient } from '@tanstack/react-query'
import { AppState } from 'react-native'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24,
      retry: 1,
    },
  },
})

// React Native には「画面に戻った」をブラウザのように知らせる仕組みが無いので、アプリが前面に
// 戻ったことを react-query に伝える（戻ったら古くなった一覧・未読数を読み直す）
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener('change', (state) => handleFocus(state === 'active'))
  return () => subscription.remove()
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
