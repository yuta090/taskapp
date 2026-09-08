import type { MetadataRoute } from 'next'

/**
 * PWA マニフェスト。
 *
 * 主目的は **iPhone でブラウザ通知を受け取れるようにすること**。
 * iOS の Safari は「ホーム画面に追加」したページ（＝standalone 表示のPWA）にしか
 * Web Push を配信しない。マニフェストが無いと追加してもただのショートカット扱いになり、
 * 通知の許可ダイアログすら出せない。
 *
 * パソコンのブラウザには元から届くので、これは iPhone/iPad のための1ファイル。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AgentPM',
    short_name: 'AgentPM',
    description: '管理・報告・調整はAIとツールに。つくることに、集中できる。',
    // ログイン済みならそのままタスク一覧に着地する（未ログインは門番が /login へ送る）
    start_url: '/my',
    scope: '/',
    display: 'standalone',
    lang: 'ja',
    background_color: '#ffffff',
    theme_color: '#4f46e5',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // maskable は端末側で好きな形に切り抜かれるため、内側80%にロゴを収めた別画像を使う
      { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
