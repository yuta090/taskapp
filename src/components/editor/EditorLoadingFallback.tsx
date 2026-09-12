/**
 * 文書エディタ（Wiki・議事録）を読み込んでいる間に出す仮の面。
 * どちらも本体が重く、あとから読み込むので、待っている間の見た目を揃える。
 */
export function EditorLoadingFallback() {
  return (
    <div className="flex h-64 animate-pulse items-center justify-center rounded-lg bg-gray-50">
      <span className="text-sm text-gray-400">エディタを読み込み中...</span>
    </div>
  )
}
