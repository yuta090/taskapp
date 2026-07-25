import { CircleNotch } from '@phosphor-icons/react/dist/ssr'

/**
 * ポータル各画面のナビゲーション中に出す読み込み表示。
 * サーバー側データ取得の間、画面が固まったように見えるのを防ぐ。
 */
export default function PortalLoading() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="flex items-center gap-2 text-gray-400">
        <CircleNotch className="w-6 h-6 animate-spin" />
        <span className="text-sm">読み込み中...</span>
      </div>
    </div>
  )
}
