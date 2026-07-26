// アバター画像アップロードの純粋ロジック（検証・パス生成・旧オブジェクトパス抽出）。
// 実際のアップロード/削除は呼び出し側が supabase.storage で行う。
// バケットは公開 'avatars'（migration: avatars_bucket）。保存パスは {uid}/{unique}.{ext}
// で、先頭フォルダ=uid が storage RLS の本人判定に対応する。

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024 // 2MB（バケットの file_size_limit と一致）

// svg は script 埋め込みで XSS の恐れがあるため意図的に除外（バケットの allowed_mime_types とも一致）。
export const ACCEPTED_AVATAR_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export type ValidationResult = { ok: true } | { ok: false; error: string }

export function validateAvatarFile(file: File): ValidationResult {
  if (!(ACCEPTED_AVATAR_MIME as readonly string[]).includes(file.type)) {
    return { ok: false, error: '画像ファイル（JPEG / PNG / WebP / GIF）を選んでください' }
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return { ok: false, error: '画像サイズは2MBまでにしてください' }
  }
  return { ok: true }
}

/** MIME から保存用拡張子を導く（未知なら 'png' にフォールバック） */
export function avatarExt(file: File): string {
  return MIME_TO_EXT[file.type] ?? 'png'
}

/**
 * 保存パス {userId}/{unique}.{ext}。unique は毎回変える（Date.now()）ことで
 * CDN/ブラウザキャッシュに邪魔されず差し替えが即反映される。
 */
export function buildAvatarPath(userId: string, file: File, unique: number): string {
  return `${userId}/${unique}.${avatarExt(file)}`
}

/**
 * 公開URLから avatars バケット内のオブジェクトパス（{uid}/{file}）を取り出す。
 * 旧アバターを差し替え後に削除するために使う。avatars 以外・別ドメインは null。
 */
export function parseAvatarObjectPath(publicUrl: string | null | undefined): string | null {
  if (!publicUrl) return null
  const marker = '/object/public/avatars/'
  const idx = publicUrl.indexOf(marker)
  if (idx === -1) return null
  const rest = publicUrl.slice(idx + marker.length)
  const path = rest.split('?')[0].split('#')[0]
  return path.length > 0 ? path : null
}
