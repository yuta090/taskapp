import type { Metadata } from 'next'
import { Toaster } from 'sonner'
import { PreferencesProviderWrapper } from '@/components/providers/PreferencesProviderWrapper'
import { ActiveOrgProvider } from '@/lib/org/ActiveOrgProvider'
import { SkipLink } from '@/components/shared/SkipLink'
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ja" className="antialiased" suppressHydrationWarning>
      <body className="font-sans">
        <SkipLink />
        <PreferencesProviderWrapper>
          <ActiveOrgProvider>
            {children}
            <Toaster position="bottom-right" richColors closeButton duration={3000} />
          </ActiveOrgProvider>
        </PreferencesProviderWrapper>
      </body>
    </html>
  )
}
