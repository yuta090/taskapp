export default function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Portal has its own layout, no AppShell
  return <>{children}</>
}
