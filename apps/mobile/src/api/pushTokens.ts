/**
 * この端末をプッシュ通知の宛先として登録する・外す。
 *
 * 登録は RPC（rpc_register_mobile_push_token）だけ。同じ端末を前に別の人が使っていたら、
 * DB 側で前の人の行を消して移す（前の人の通知をこの端末に届けない）。2段階認証が必要な人は
 * 2段階目を通すまで登録できない（mfa_required）。
 * 送るのは Web の /api/push/dispatch（src/lib/push/sendExpoPush.ts）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { cleanupPushAfterSignedOut } from '~/lib/signedOutCleanup'
import { unregisterPushToken, type UnregisterResult } from '~/lib/unregisterPushToken'
import { postWebApi } from './webApi'
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
 * 失敗してもログアウトは止めない（~/lib/unregisterPushToken.ts）。
 *
 * 自分でログアウトせずに切れた場合は unregisterAfterSignedOut（サーバーに頼んで外す）。
 */
export function unregisterStoredPushToken(): Promise<UnregisterResult> {
  return unregisterPushToken({
    getStoredToken: () => AsyncStorage.getItem(STORED_TOKEN_KEY),
    deleteTokenRow: async (token) => {
      const { error } = await supabase.from('mobile_push_tokens').delete().eq('token', token)
      return { error }
    },
    clearStoredToken: () => AsyncStorage.removeItem(STORED_TOKEN_KEY),
  })
}

/**
 * 自分のログアウト以外でログインが切れたとき（期限切れ・他の端末から全端末ログアウト）に呼ぶ。
 * もう DB に触れないので、Web の /api/mobile/push-token/unregister にトークンを渡して外してもらう。
 */
export function unregisterAfterSignedOut(manual: boolean): Promise<void> {
  return cleanupPushAfterSignedOut({
    manual,
    getStoredToken: () => AsyncStorage.getItem(STORED_TOKEN_KEY),
    postUnregister: async (token) => (await postWebApi('/api/mobile/push-token/unregister', { token }, { auth: false })).ok,
    clearStoredToken: () => AsyncStorage.removeItem(STORED_TOKEN_KEY),
  })
}
