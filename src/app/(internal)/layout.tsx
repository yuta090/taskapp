import { AppShell } from '@/components/layout'
import { QueryProvider } from '@/components/providers/QueryProvider'

export default function InternalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <QueryProvider>
      <AppShell>{children}</AppShell>
    </QueryProvider>
  )
}
