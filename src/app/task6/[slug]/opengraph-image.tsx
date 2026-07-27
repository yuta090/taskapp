import { ImageResponse } from 'next/og'
import { getPublishedPostSummary } from '@/lib/blog/posts'
import { loadNotoSansJP } from '@/lib/task6/ogFont'
import { loadOgArtDataUri } from '@/lib/task6/ogArt'

// 記事ごとのOGP画像 兼 一覧サムネイル(バナー)。
// イラスト(cover_image_url)があれば「左=タイトル文字/右=イラスト」の固定フォーマットで合成する。
// 文字はここで描くので生成AIに文字を作らせない(日本語が崩れるため)。イラスト無し記事は文字のみ版。
// 生成は重い(フォント取得+描画)ため1日キャッシュ(ISR)。一覧のfan-outは初回のみ

export const revalidate = 86400
export const alt = 'TASK6 記事のアイキャッチ'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const BRAND_TEXT = 'TASK6仕事がまわる学びのメディア'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function Image({ params }: Props) {
  const { slug } = await params
  const post = await getPublishedPostSummary(slug)
  // 未公開・不在slugはサイト共通OGへ寄せる(任意slug連打でのフォント取得・重描画・キャッシュ肥大を防ぐ)
  if (!post) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/task6/opengraph-image' },
    })
  }
  const title = post.title
  const author = post.author_name ?? ''

  // フォントとイラストは互いに独立なので並列取得。イラストは自前fetch+タイムアウトで
  // data URI化し、失敗時は null → 文字のみ版バナーへフォールバック(500を返さずISRに乗せる)
  const artUrl = post.cover_image_url?.startsWith('https://') ? post.cover_image_url : null
  const [font, art] = await Promise.all([
    loadNotoSansJP(`${title}${author}${BRAND_TEXT}`, 700),
    artUrl ? loadOgArtDataUri(artUrl) : Promise.resolve(null),
  ])
  // 長いタイトルは文字を小さくして3行に収める(イラストありは文字幅が狭いので一段小さく)
  const titleSize = art
    ? title.length > 45
      ? 46
      : title.length > 24
        ? 52
        : 60
    : title.length > 45
      ? 56
      : title.length > 24
        ? 64
        : 76

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#fffbf5',
          fontFamily: font ? 'NotoSansJP' : 'sans-serif',
        }}
      >
        {/* 上端のブランドバー */}
        <div style={{ display: 'flex', height: 14, width: '100%', background: '#f59e0b' }} />

        <div style={{ flex: 1, display: 'flex' }}>
          {/* 左: 文字ブロック(全記事で固定フォーマット・入れ替わるのはテキストだけ) */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: art ? '48px 48px 40px 64px' : '56px 80px 48px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, lineHeight: 1 }}>
                <span style={{ color: '#0f172a' }}>TASK</span>
                <span style={{ color: '#f59e0b' }}>6</span>
              </div>
              <div style={{ width: 2, height: 30, background: '#e2e8f0' }} />
              <div style={{ fontSize: 24, color: '#64748b' }}>仕事がまわる学びのメディア</div>
            </div>

            <div
              style={{
                fontSize: titleSize,
                fontWeight: 700,
                color: '#0f172a',
                lineHeight: 1.35,
                letterSpacing: '-0.02em',
                display: 'block',
                lineClamp: 3,
              }}
            >
              {title}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                {author ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      background: '#f59e0b',
                      color: '#ffffff',
                      fontSize: 22,
                      fontWeight: 700,
                    }}
                  >
                    {author.slice(0, 1)}
                  </div>
                ) : null}
                <div style={{ fontSize: 26, color: '#475569' }}>{author}</div>
              </div>
              <div style={{ display: 'flex', fontSize: 24, color: '#94a3b8' }}>
                agentpm.app/task6
              </div>
            </div>
          </div>

          {/* 右: イラスト(記事ごとに差し替わる部分) */}
          {art ? (
            <div style={{ display: 'flex', width: 460, height: '100%' }}>
              <img
                src={art}
                alt=""
                width={460}
                height={616}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          ) : null}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: font
        ? [{ name: 'NotoSansJP', data: font, weight: 700 as const, style: 'normal' as const }]
        : undefined,
    }
  )
}
