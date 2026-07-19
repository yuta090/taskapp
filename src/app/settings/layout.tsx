export const dynamic = 'force-dynamic'

// QueryProvider はルート(app/layout.tsx)に集約したためここでは張らない。
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
