import { ManualSidebar } from '@/components/docs/ManualSidebar'

export const metadata = {
  title: 'マニュアル | TaskApp',
  description: 'TaskApp のご利用マニュアル',
}

export default function ManualLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <ManualSidebar />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
