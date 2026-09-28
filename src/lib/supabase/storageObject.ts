/**
 * Storage のオブジェクトを、**書き換えた直後でも必ず最新の中身で**取り出す。
 *
 * なぜ supabase-js の `storage.download()` を使わないか（2026-09-17 に本番の Storage で実測）:
 * 同じ置き場所を上書きしたあと、**オブジェクトの URL の手前にあるキャッシュが古い中身を
 * 返し続ける**（上書き成功の直後から 2 秒以上たっても古いまま）。`download()` はこれを
 * よけないし、同じ URL への素の fetch も同じく古いままだった。一方、**版を付けた URL**
 * または `cache: 'no-store'` を付けた取得は、同じ瞬間でも新しい中身が返ってきた。
 *
 * 表の編集で同じ id のまま中身が変わるようになったため、これに当たると
 * 「直して読み込み直すと元に戻る」ように見える——保存は成功しているのに失敗したように
 * 見える、一番たちの悪い形になる（E2E で実際に踏んだ）。
 *
 * そこで **版（files.updated_at）を付けた URL を、`cache: 'no-store'` で毎回取りにいく**。
 * 版を付けるのは、間に入るキャッシュにとって上書きの前後が別の入れ物になるようにするため
 * （no-store だけに頼らない二段構え）。
 *
 * サーバー専用（service role の鍵を使う）。'use client' から import しないこと。
 */

const AUTHENTICATED_OBJECT_PREFIX = '/storage/v1/object/authenticated'

function requireEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase configuration for storage object access')
  }
  return { url, key }
}

/**
 * 取り出し先の URL。`version` を渡すと `?v=` を付ける（同じ置き場所でも中身が変われば別の URL）。
 * 置き場所の区切り（/）はそのまま残し、各区切りの中だけを URL 用に直す。
 */
export function storageObjectUrl(
  supabaseUrl: string,
  bucket: string,
  storagePath: string,
  version?: string | null
): string {
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/')
  const base = `${supabaseUrl.replace(/\/$/, '')}${AUTHENTICATED_OBJECT_PREFIX}/${bucket}/${encodedPath}`
  return version ? `${base}?v=${encodeURIComponent(version)}` : base
}

/**
 * オブジェクトを取り出す。応答をそのまま返すので、呼び出し側は body を流すだけでよい
 * （丸ごと組み立てない）。
 */
export async function fetchStorageObject(
  bucket: string,
  storagePath: string,
  version?: string | null
): Promise<Response> {
  const { url, key } = requireEnv()
  return fetch(storageObjectUrl(url, bucket, storagePath, version), {
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
    // 間に入るキャッシュを使わない（版付き URL と二段構え）
    cache: 'no-store',
  })
}
