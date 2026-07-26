import { ImageResponse } from 'next/og'
import { getPublishedPostSummary } from '@/lib/blog/posts'
import { loadNotoSansJP } from '@/lib/task6/ogFont'

// 記事ごとのOGP画像 兼 一覧サムネイル。記事タイトルから自動生成する
// (手作業でサムネを作らなくても、全記事に統一デザインの看板画像が付く)
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
  const title = post?.title ?? 'TASK6 — 仕事がまわる学びのメディア'
  const author = post?.author_name ?? ''

  const font = await loadNotoSansJP(`${title}${author}${BRAND_TEXT}`, 700)
  // 長いタイトルは文字を小さくして3行に収める
  const titleSize = title.length > 45 ? 56 : title.length > 24 ? 64 : 76

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

        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '56px 80px 48px',
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
