import { loadEmailTemplateRows } from '@/lib/email/templates/loadEmailTemplate'
import EmailTemplatesClient from './EmailTemplatesClient'

/**
 * /admin/email-templates — メール文面の編集（運営専用）。
 * 表示は email_templates を1クエリ読むだけ（台帳の件数分・数行）。保存は /api/admin/email-templates。
 * 親 layout が superadmin ゲートを通しているので、ここでは追加の認可チェックをしない。
 */
export default async function AdminEmailTemplatesPage() {
  const rows = await loadEmailTemplateRows()
  const appName = process.env.NEXT_PUBLIC_APP_NAME || 'AgentPM'
  return <EmailTemplatesClient initialRows={rows} appName={appName} />
}
