import { QueryProvider } from '@/components/providers/QueryProvider'

// Portal pages use PortalLeftNav → usePortalVisibilityForPortal, which is a
// React Query hook. Unlike (internal)/layout.tsx, this tree previously had no
// QueryClientProvider, so every portal page crashed with
// "No QueryClient set, use QueryClientProvider to set one".
export default function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <QueryProvider>{children}</QueryProvider>
}
