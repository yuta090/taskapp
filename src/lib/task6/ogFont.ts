/**
 * OG画像(ImageResponse)用の日本語フォント読み込み。
 * Google Fonts のサブセットAPIを使い、描画に必要な文字だけのフォントを取得する
 * (日本語フルセットは数MBあるため全量は埋め込めない)。
 * 取得失敗時は null を返し、呼び出し側はデフォルトフォントで描画を続行する
 * (ローカルのオフラインビルドでもOG生成自体は失敗させない)。
 */

export async function loadNotoSansJP(
  text: string,
  weight: 400 | 700 = 700
): Promise<ArrayBuffer | null> {
  try {
    // 重複文字を除いて問い合わせを小さくする
    const unique = Array.from(new Set(text)).join('')
    const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@${weight}&text=${encodeURIComponent(unique)}`
    const css = await (
      await fetch(cssUrl, {
        // woff2でなくttf/otfを返させる(ImageResponseはwoff2非対応)
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; og-image-generator)' },
      })
    ).text()
    const match = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)
    if (!match) return null
    const res = await fetch(match[1])
    if (!res.ok) return null
    return await res.arrayBuffer()
  } catch {
    return null
  }
}
