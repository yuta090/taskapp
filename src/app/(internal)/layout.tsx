import { AppShell } from '@/components/layout'
import { PushPromptBanner } from '@/components/notification/PushPromptBanner'

// Note: force-dynamic を除去。認証チェックはmiddlewareとクライアントhooksで行うため、
// レイアウトレベルでのSSG/ISR無効化は不要。各ページが必要に応じて個別に設定する。
// QueryProvider はルート(app/layout.tsx)に集約したためここでは張らない。

export default function InternalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AppShell>
      {/* ブラウザ通知の1回だけの案内。まだ可否を答えていない人にしか出ない（出さない人には
          service worker の登録すら走らない作りにしてある） */}
      <PushPromptBanner />
      {children}
    </AppShell>
  )
}
