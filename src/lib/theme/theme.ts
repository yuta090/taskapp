// テーマ（ライト/ダーク/システム）の解決・適用の単一実装。
// - 保存は localStorage（cookie を使わない＝LP/task6 の static rendering を壊さない）
// - 適用は <html> の .dark クラス切替（中央トークン反転で全画面が反転する）
// - ダーク対象は「ログイン後のアプリ画面」のみ。公開/マーケ＋クライアント portal は
//   ライト固定（isDarkAllowedPath）。判定は proxy の publicPaths と単一ソース。

import { publicPaths, STATIC_LP_PATTERN, isPublicPathMatch } from '@/lib/routes/publicPaths'

export type Theme = 'light' | 'dark' | 'system'

export const THEME_STORAGE_KEY = 'taskapp:prefs:theme'
export const DEFAULT_THEME: Theme = 'light'

// portal / vendor-portal は認証必須だがクライアント（相手先）向けのため未検証。
// マーケと同じくライト固定にする（アプリ本体のみダーク）。
export const DARK_DENY_PREFIXES = ['/portal', '/vendor-portal'] as const

/** このパスでダークを許可するか（公開/マーケ・portal はライト固定） */
export function isDarkAllowedPath(pathname: string): boolean {
  if (isPublicPathMatch(pathname)) return false
  return !DARK_DENY_PREFIXES.some(
    prefix => pathname === prefix || pathname.startsWith(prefix + '/'),
  )
}

export function isValidTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system'
}

/** localStorage から現在のテーマ設定を読む（無効値・SSRは既定 light） */
export function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
  return isValidTheme(raw) ? raw : DEFAULT_THEME
}

/** OS がダークを要求しているか */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** テーマ設定＋現在パスから、実際にダークにすべきか解決する */
export function resolveDark(theme: Theme, pathname: string): boolean {
  if (!isDarkAllowedPath(pathname)) return false
  if (theme === 'dark') return true
  if (theme === 'system') return systemPrefersDark()
  return false
}

/** <html> の .dark クラスを付け外しする */
export function applyDarkClass(dark: boolean): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', dark)
}

/**
 * 描画前に <head> で実行するインラインスクリプト本体。
 * publicPaths / LP パターン / portal 除外を「ビルド時に埋め込んで」複製し、
 * paint 前に .dark を付与して白チラつき(FOUC)を防ぐ。
 * データ（publicPaths）は単一ソースから直列化するのでドリフトしない。
 */
export function buildThemeInitScript(): string {
  const pub = JSON.stringify(publicPaths)
  const deny = JSON.stringify(DARK_DENY_PREFIXES)
  const lp = STATIC_LP_PATTERN.source
  const key = THEME_STORAGE_KEY
  return `(function(){try{
var t=localStorage.getItem(${JSON.stringify(key)})||'light';
var d=t==='dark'||(t==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);
if(!d)return;
var p=location.pathname;var PUB=${pub};var DENY=${deny};var LP=/${lp}/;
function pub(x){if(LP.test(x))return true;return PUB.some(function(q){return q==='/'?x==='/':(x===q||x.indexOf(q+'/')===0)})}
if(pub(p))return;
for(var i=0;i<DENY.length;i++){var q=DENY[i];if(p===q||p.indexOf(q+'/')===0)return}
document.documentElement.classList.add('dark');
}catch(e){}})();`
}
