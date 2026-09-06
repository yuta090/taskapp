/** HTMLエスケープ（XSS対策）。メール本文に差し込むユーザー入力は必ずこれを通す */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, (char) => map[char] || char)
}

/** URL を属性値に安全に埋め込む */
export function escapeUrlForHtml(url: string): string {
  return escapeHtml(url)
}

/** 改行を <br> に変換した上でエスケープする（複数行テキスト表示用） */
export function escapeHtmlMultiline(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>')
}
