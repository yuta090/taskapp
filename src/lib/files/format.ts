// プロジェクト共有ファイルの表示用フォーマッタ。
// src/app/portal/files/PortalFilesClient.tsx にも同等のローカル実装があるが、
// そちらは別ストリームが編集中のため重複を避けず、こちらを共通実装として切り出す。

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// 一覧の全行で使うので、書式オブジェクトはモジュールに1つだけ作って使い回す。
// 行ごとに toLocaleDateString(オプション付き) を呼ぶと 1000 行で 40ms 超かかり、
// 説明文の入力1打鍵ごとにそのコストが乗る(TaskRow も Intl を毎回作らない方針)。
const FILE_DATE_FORMAT = new Intl.DateTimeFormat('ja-JP', { month: 'short', day: 'numeric' })

export function formatFileDate(dateStr: string): string {
  return FILE_DATE_FORMAT.format(new Date(dateStr))
}
