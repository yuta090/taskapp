import { QueryProvider } from '@/components/providers/QueryProvider'

export const dynamic = 'force-dynamic'

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <QueryProvider>{children}</QueryProvider>
}
