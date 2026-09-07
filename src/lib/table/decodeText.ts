/**
 * バイト列 → 文字列。UTF-8 として読めなければ Shift_JIS で読み直す。
 * 日本の業務 CSV(Excel 保存・Salesforce 出力など)は Shift_JIS が多いため。
 */
export type TextEncodingName = 'utf-8' | 'shift_jis'

export function decodeTextBuffer(buffer: ArrayBuffer): { text: string; encoding: TextEncodingName } {
  if (buffer.byteLength === 0) return { text: '', encoding: 'utf-8' }
  try {
    // fatal: 不正なバイト列で例外にする(既定は U+FFFD に置き換えて黙る)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return { text, encoding: 'utf-8' }
  } catch {
    const text = new TextDecoder('shift_jis').decode(buffer)
    return { text, encoding: 'shift_jis' }
  }
}
