import { createAdminClient } from '@/lib/supabase/admin'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'

interface InviteRow {
  id: string
  org_id: string
  space_id: string
  email: string
  role: string
  expires_at: string
  accepted_at: string | null
  created_at: string
  orgName: string
  spaceName: string
  status: { label: string; variant: 'success' | 'danger' | 'warning' }
}

async function fetchInviteData() {
  const admin = createAdminClient()
  const nowMs = Date.now()

  const [{ data: invites }, { data: orgs }, { data: spaces }] = await Promise.all([
    admin.from('invites').select('id, org_id, space_id, email, role, expires_at, accepted_at, created_at').order('created_at', { ascending: false }),
    admin.from('organizations').select('id, name'),
    admin.from('spaces').select('id, name'),
  ])

  const orgMap = new Map<string, string>()
  orgs?.forEach((o) => orgMap.set(o.id, o.name))
  const spaceMap = new Map<string, string>()
  spaces?.forEach((s) => spaceMap.set(s.id, s.name))

  function getStatus(invite: { accepted_at: string | null; expires_at: string }) {
    if (invite.accepted_at) return { label: '承認済み', variant: 'success' as const }
    if (new Date(invite.expires_at).getTime() < nowMs) return { label: '期限切れ', variant: 'danger' as const }
    return { label: '未承認', variant: 'warning' as const }
  }

  const rows: InviteRow[] = (invites ?? []).map((inv) => ({
    id: inv.id,
    org_id: inv.org_id,
    space_id: inv.space_id,
    email: inv.email,
    role: inv.role,
    expires_at: inv.expires_at,
    accepted_at: inv.accepted_at,
    created_at: inv.created_at,
    orgName: orgMap.get(inv.org_id) ?? '-',
    spaceName: spaceMap.get(inv.space_id) ?? '-',
    status: getStatus(inv),
  }))

  const pending = rows.filter((r) => r.status.variant === 'warning').length
  const expired = rows.filter((r) => r.status.variant === 'danger').length
  const accepted = rows.filter((r) => r.status.variant === 'success').length

  return { rows, pending, expired, accepted }
}

export default async function AdminInvitesPage() {
  const { rows, pending, expired, accepted } = await fetchInviteData()

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title="招待トラッキング"
        description={`未承認 ${pending} / 期限切れ ${expired} / 承認済み ${accepted}`}
      />

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">メール</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">ロール</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">組織</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">スペース</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">ステータス</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">有効期限</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">作成日</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((inv) => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-900 font-mono text-xs">{inv.email}</td>
                  <td className="px-4 py-2.5">
                    <AdminBadge variant={inv.role === 'client' ? 'info' : 'default'}>{inv.role}</AdminBadge>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{inv.orgName}</td>
                  <td className="px-4 py-2.5 text-gray-600">{inv.spaceName}</td>
                  <td className="px-4 py-2.5"><AdminBadge variant={inv.status.variant}>{inv.status.label}</AdminBadge></td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{new Date(inv.expires_at).toLocaleDateString('ja-JP')}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{new Date(inv.created_at).toLocaleDateString('ja-JP')}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">招待がありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
