/**
 * Google でログインする（Web の GoogleSignInButton と同じ Supabase の Google ログイン）。
 *
 * ブラウザ（アプリ内の認証画面）で Google にログインし、agentpm://auth/callback でアプリに戻る。
 * 戻り先は Supabase の「Redirect URLs」に登録が要る（apps/mobile/README.md）。
 */
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import { parseOAuthCallback } from '~/lib/oauthCallback'
import { supabase } from './supabase'

export type GoogleSignInResult = { ok: true } | { ok: false; cancelled: boolean; message?: string }

export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  const redirectTo = Linking.createURL('auth/callback')
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  })
  if (error || !data.url) return { ok: false, cancelled: false, message: 'Google ログインを始められませんでした' }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
  if (result.type !== 'success') return { ok: false, cancelled: true }

  const parsed = parseOAuthCallback(result.url)
  if ('error' in parsed) return { ok: false, cancelled: false, message: parsed.error }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(parsed.code)
  if (exchangeError) return { ok: false, cancelled: false, message: 'ログインできませんでした。もう一度お試しください' }
  return { ok: true }
}
