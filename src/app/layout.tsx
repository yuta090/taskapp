import type { Metadata } from 'next'
import { Toaster } from 'sonner'
import { PreferencesProviderWrapper } from '@/components/providers/PreferencesProviderWrapper'
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
          {children}
          <Toaster position="bottom-right" richColors closeButton duration={3000} />
        </PreferencesProviderWrapper>
      </body>
    </html>
  )
}
