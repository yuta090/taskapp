import { AppShell } from '@/components/layout'

export default function InternalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AppShell>{children}</AppShell>
}
