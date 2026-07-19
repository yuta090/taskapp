// Portal pages use PortalLeftNav → usePortalVisibilityForPortal, a React Query
// hook. The QueryClient is now provided app-wide by the root app/layout.tsx,
// so this layout no longer needs its own QueryProvider.
export default function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
