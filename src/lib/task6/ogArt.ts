/**
 * OGバナー合成用のイラスト取得。
 * ImageResponse内の <img src={外部URL}> は描画エンジンが自前fetchし、失敗すると
 * ルート全体が500になる(500はISRキャッシュされず、壊れたカバー1枚で重い再生成が
 * 毎アクセス走り続ける)。そこで先にこちらでfetchし、タイムアウト・失敗・非対応
 * フォーマットはすべて null を返して文字のみバナーへフォールバックさせる。
 * ogFont.ts の「自前fetch+タイムアウト+失敗時null」と同じ流儀。
 */
export async function loadOgArtDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim()
    // 描画エンジン(satori/resvg)が確実に扱えるのはPNG/JPEGのみ
    if (!/^image\/(png|jpe?g)$/.test(contentType)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return `data:${contentType};base64,${buf.toString('base64')}`
  } catch (e) {
    console.warn('[task6-og] cover art fetch failed:', url, e)
    return null
  }
}

/**
 * og:image用のURLに変換する。サイト表示はWebPだが、シェア画像は一部サービス
 * (LINE等)がWebPを表示できないため、同名で併置してあるJPEGを使う。
 */
export function toOgSafeImageUrl(url: string): string {
  return url.replace(/\.webp$/, '.jpg')
}
