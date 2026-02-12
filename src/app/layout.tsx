import type { Metadata } from 'next'
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
        {children}
      </body>
    </html>
  )
}
