import type { Metadata } from 'next'
import { Toaster } from 'sonner'
import { PreferencesProviderWrapper } from '@/components/providers/PreferencesProviderWrapper'
import { ActiveOrgProvider } from '@/lib/org/ActiveOrgProvider'
import './globals.css'

export const metadata: Metadata = {
  title: 'TaskApp',
  description: 'Client-facing project management with ball ownership',
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
          <ActiveOrgProvider>
            {children}
            <Toaster position="bottom-right" richColors closeButton duration={3000} />
          </ActiveOrgProvider>
        </PreferencesProviderWrapper>
      </body>
    </html>
  )
}
