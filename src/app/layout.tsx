import type { Metadata, Viewport } from 'next'
import { Toaster } from 'sonner'
import { PreferencesProviderWrapper } from '@/components/providers/PreferencesProviderWrapper'
import { QueryProvider } from '@/components/providers/QueryProvider'
import { ActiveOrgProvider } from '@/lib/org/ActiveOrgProvider'
import { SkipLink } from '@/components/shared/SkipLink'
import { ThemeSync } from '@/components/theme/ThemeSync'
import { buildThemeInitScript } from '@/lib/theme/theme'
import './globals.css'

export const metadata: Metadata = {
  title: 'AgentPM - つくることに、集中できる',
  description: '管理・報告・調整はAIとツールに。AgentPMなら、あなたのチームは最高のアウトプットを届けることに専念できます。',
  metadataBase: new URL('https://agentpm.jp'),
  openGraph: {
    title: 'AgentPM - つくることに、集中できる',
    description: '管理・報告・調整はAIとツールに。AgentPMなら、あなたのチームは最高のアウトプットを届けることに専念できます。',
    locale: 'ja_JP',
    type: 'website',
    images: [{ url: '/img/og/ogp.png', width: 1200, height: 630, alt: 'AgentPM' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AgentPM - つくることに、集中できる',
    description: '管理・報告・調整はAIとツールに。AgentPMなら、あなたのチームは最高のアウトプットを届けることに専念できます。',
    images: ['/img/og/ogp.png'],
  },
}

// device-width viewport for mobile responsiveness. Zoom left enabled (no maximum-scale) for a11y.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ja" className="antialiased" suppressHydrationWarning>
      <head>
        {/* 描画前に .dark を付与しFOUC（白チラつき）を防ぐ。localStorage参照・
            cookie不使用のためLP/task6のstatic renderingを壊さない。publicPaths等は
            ビルド時に埋め込み（単一ソースから直列化）。 */}
        <script dangerouslySetInnerHTML={{ __html: buildThemeInitScript() }} />
      </head>
      <body className="font-sans">
        <ThemeSync />
        <SkipLink />
        <PreferencesProviderWrapper>
          {/* Single app-wide QueryProvider. ActiveOrgProvider (below) calls
              useCurrentUser, now a react-query hook, so a QueryClient must be
              in context on every route — including static marketing pages and
              /_not-found. Route-group layouts no longer mount their own
              QueryProvider (that would nest PersistQueryClientProviders on the
              same IDB key). One long-lived client also shares cache across
              route groups. */}
          <QueryProvider>
            <ActiveOrgProvider>
              {children}
              <Toaster position="bottom-right" richColors closeButton duration={3000} />
            </ActiveOrgProvider>
          </QueryProvider>
        </PreferencesProviderWrapper>
      </body>
    </html>
  )
}
