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
