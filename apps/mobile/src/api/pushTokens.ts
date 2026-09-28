/**
 * この端末をプッシュ通知の宛先として登録する・外す。
 *
 * 登録は RPC（rpc_register_mobile_push_token）だけ。同じ端末を前に別の人が使っていたら、
 * DB 側で前の人の行を消して移す（前の人の通知をこの端末に届けない）。2段階認証が必要な人は
 * 2段階目を通すまで登録できない（mfa_required）。
 * 送るのは Web の /api/push/dispatch（src/lib/push/sendExpoPush.ts）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

const STORED_TOKEN_KEY = 'agentpm-push-token'

export async function registerPushToken(token: string, platform: 'ios' | 'android', appVersion: string | null) {
  const { error } = await supabase.rpc('rpc_register_mobile_push_token', {
    p_token: token,
    p_platform: platform,
    p_app_version: appVersion,
  })
  if (error) throw error
  await AsyncStorage.setItem(STORED_TOKEN_KEY, token).catch(() => {})
}

/**
 * ログアウトの前に呼ぶ。この端末に前の人の通知が届き続けないように、自分の行を消す。
 * 失敗してもログアウトは止めない（次に別の人が登録すれば DB 側で移る）。
 */
export async function unregisterStoredPushToken(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(STORED_TOKEN_KEY)
    if (!token) return
    await supabase.from('mobile_push_tokens').delete().eq('token', token)
    await AsyncStorage.removeItem(STORED_TOKEN_KEY)
  } catch (e) {
    console.warn('[push] Failed to unregister push token:', e)
  }
}
