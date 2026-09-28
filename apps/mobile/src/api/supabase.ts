import 'react-native-url-polyfill/auto'
import { createClient, processLock, type SupabaseClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'
import { AppState, Platform } from 'react-native'
import type { Database } from '@/types/database'
import { createChunkedStorage } from '~/lib/chunkedStorage'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY が未設定です（apps/mobile/.env.example を参照）')
}

// ログイン情報は端末の安全な保管場所（iOS はキーチェーン、Android は Keystore）に入れる
const secureStorage = createChunkedStorage({
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
})

/**
 * 表の読み書きに使う。型は付けない: Web の手書きの Database 型は supabase-js の書き込み用の型と
 * 噛み合わない部分があり（Web も同じ所は SupabaseClient にキャストしている）、読んだ結果は
 * 呼ぶ側で Database の行の型に当てはめる。
 */
export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: {
    // Web 表示（画面の確認用。配布はしない）には SecureStore が無いので、supabase-js 既定の localStorage を使う
    storage: Platform.OS === 'web' ? undefined : secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    // アプリには URL でセッションを受け取る仕組みが無い（Web の /auth/callback 相当は無い）
    detectSessionInUrl: false,
    lock: processLock,
  },
})

// 画面が前にある間だけトークンを自動で更新する（裏に回ったら止め、戻ったら再開する）
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh()
  else supabase.auth.stopAutoRefresh()
})

/** Web と共有する RPC ラッパー（@/lib/supabase/rpc）に渡す用。中身は上と同じクライアント */
export const typedSupabase = supabase as unknown as SupabaseClient<Database>
