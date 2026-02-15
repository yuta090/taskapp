import type { Metadata } from 'next'
import { Toaster } from 'sonner'
import { PreferencesProviderWrapper } from '@/components/providers/PreferencesProviderWrapper'
import './globals.css'

export const metadata: Metadata = {
  title: 'AgentPM - つくることに、集中できる',
  description: '管理・報告・調整はAIとツールに。AgentPMなら、あなたのチームは最高のアウトプットを届けることに専念できます。',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ja" className="antialiased">
      <body className="font-sans">
        <PreferencesProviderWrapper>
          {children}
          <Toaster position="bottom-right" richColors closeButton duration={3000} />
        </PreferencesProviderWrapper>
      </body>
    </html>
  )
}
