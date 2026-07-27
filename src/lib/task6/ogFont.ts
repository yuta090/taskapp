/**
 * OG画像(ImageResponse)用の日本語フォント読み込み。
 * Google Fonts のサブセットAPIを使い、描画に必要な文字だけのフォントを取得する
 * (日本語フルセットは数MBあるため全量は埋め込めない)。
 * 取得失敗時は null を返し、呼び出し側はデフォルトフォントで描画を続行する
 * (ローカルのオフラインビルドでもOG生成自体は失敗させない)。
 * ⚠ null時は日本語が描画されない(豆腐)ため、warnで観測可能にしておく。
 */

const FETCH_TIMEOUT_MS = 3000

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
        // woff2でなくttf/otf/woffを返させる(ImageResponse=satoriはwoff2非対応)。
        // 古いUAを名乗るとGoogle Fontsは静的フォーマットを返す
        headers: { 'User-Agent': 'Mozilla/4.0 (compatible; og-image-generator)' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
    ).text()
    const match = css.match(/src: url\((.+?)\) format\('(opentype|truetype|woff)'\)/)
    if (!match) {
      console.warn('[ogFont] font format not found in css response (woff2 only?)')
      return null
    }
    const res = await fetch(match[1], { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) {
      console.warn(`[ogFont] font fetch failed: ${res.status}`)
      return null
    }
    return await res.arrayBuffer()
  } catch (e) {
    console.warn('[ogFont] font load failed, falling back to default font:', e)
    return null
  }
}
