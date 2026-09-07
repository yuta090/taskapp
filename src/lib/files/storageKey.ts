/**
 * Supabase Storage の鍵(保存先パス)に使える文字は ASCII の一部だけ
 * (storage-api の isValidKey: \w / ! - . * ' ( ) 空白 & $ @ = ; : + , ?)。
 * 日本語や全角記号を含む名前をそのまま鍵にすると "InvalidKey" で PUT が失敗する。
 * 表示用の名前は files.name にそのまま残し、鍵に使う部分だけをここで英数字に落とす。
 */
const MAX_BASE_LENGTH = 100

function toSafeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
}

/** 表示名 → Storage の鍵に使うファイル名。拡張子は保ち、それ以外の非ASCIIは "_" にまとめる */
export function toStorageKeyName(name: string): string {
  const trimmed = name.trim()
  const dot = trimmed.lastIndexOf('.')
  const hasExt = dot > 0 && dot < trimmed.length - 1
  const base = hasExt ? trimmed.slice(0, dot) : trimmed
  const ext = hasExt ? toSafeSegment(trimmed.slice(dot + 1)) : ''
  const safeBase = (toSafeSegment(base) || 'file').slice(0, MAX_BASE_LENGTH)
  return ext ? `${safeBase}.${ext}` : safeBase
}

/** 鍵として使える文字だけかどうか(テスト・防御用) */
export function isStorageSafeKeyName(name: string): boolean {
  return name.length > 0 && /^[A-Za-z0-9._-]+$/.test(name)
}
