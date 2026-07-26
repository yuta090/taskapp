import { ImageResponse } from 'next/og'
import { loadNotoSansJP } from '@/lib/task6/ogFont'

// TASK6 サイト共通のOGP画像(SNS共有時の看板)。内容固定のため長期キャッシュでよい

export const revalidate = 86400
export const alt = 'TASK6 — 仕事がまわる学びのメディア'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const TAGLINE = '仕事がまわる学びのメディア'
const SUB = 'タスク管理・プロジェクト管理・仕事の進め方を、実話から学ぶ'

export default async function Image() {
  const font = await loadNotoSansJP(`${TAGLINE}${SUB}TASK6agentpm.app/task6`, 700)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0f172a',
          padding: '72px 88px',
          fontFamily: font ? 'NotoSansJP' : 'sans-serif',
          position: 'relative',
        }}
      >
        {/* 右側の大きな「6」の透かし */}
        <div
          style={{
            position: 'absolute',
            right: -40,
            bottom: -140,
            fontSize: 620,
            fontWeight: 700,
            color: 'rgba(245,158,11,0.14)',
            lineHeight: 1,
          }}
        >
          6
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 56, height: 8, background: '#f59e0b', borderRadius: 4 }} />
          <div style={{ fontSize: 30, color: '#fbbf24', fontWeight: 700 }}>{TAGLINE}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 200, fontWeight: 700, lineHeight: 1 }}>
            <span style={{ color: '#ffffff' }}>TASK</span>
            <span style={{ color: '#f59e0b' }}>6</span>
          </div>
          <div style={{ marginTop: 28, fontSize: 34, color: '#cbd5e1' }}>{SUB}</div>
        </div>

        <div style={{ display: 'flex', fontSize: 26, color: '#64748b' }}>agentpm.app/task6</div>
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
