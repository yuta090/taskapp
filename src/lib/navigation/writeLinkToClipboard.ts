/**
 * リンクをクリップボードに入れる。書式を受け取る所（Slack・メール）にはリンクとして、
 * ただの文字しか受け取らない所（タスクの説明文）には文字として貼れるよう、2つの形を入れる。
 *
 * 2つの形を入れられないブラウザや、断られたときは文字だけで入れ直す。
 * 入れられたら true。例外は投げない（押した人に「できなかった」と伝えるのは呼び出し側）。
 */
export async function writeLinkToClipboard(payload: { plain: string; html: string }): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (!clipboard) return false

  const Item = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
  if (Item && typeof clipboard.write === 'function') {
    try {
      await clipboard.write([
        new Item({
          'text/plain': new Blob([payload.plain], { type: 'text/plain' }),
          'text/html': new Blob([payload.html], { type: 'text/html' }),
        }),
      ])
      return true
    } catch {
      // 下で文字だけを試す
    }
  }

  try {
    await clipboard.writeText(payload.plain)
    return true
  } catch {
    return false
  }
}
