import { QueryProvider } from '@/components/providers/QueryProvider'

// Vendor portal pages use PortalLeftNav → usePortalVisibilityForPortal, which
// is a React Query hook. This tree previously had no QueryClientProvider, so
// every vendor-portal page crashed with
// "No QueryClient set, use QueryClientProvider to set one".
export default function VendorPortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <QueryProvider>{children}</QueryProvider>
}
