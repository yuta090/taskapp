import { createAdminClient } from '@/lib/supabase/admin'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'

export default async function AdminApiKeysPage() {
  const admin = createAdminClient()

  const [{ data: keys }, { data: orgs }, { data: spaces }] = await Promise.all([
    admin.from('api_keys').select('id, org_id, space_id, name, key_prefix, is_active, last_used_at, expires_at, created_at').order('created_at', { ascending: false }),
    admin.from('organizations').select('id, name'),
    admin.from('spaces').select('id, name'),
  ])

  const orgMap = new Map<string, string>()
  orgs?.forEach((o) => orgMap.set(o.id, o.name))
  const spaceMap = new Map<string, string>()
  spaces?.forEach((s) => spaceMap.set(s.id, s.name))

  const activeCount = keys?.filter((k) => k.is_active).length ?? 0

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title="APIキー管理"
        description={`${keys?.length ?? 0} キー (アクティブ: ${activeCount})`}
      />

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">名前</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">プレフィックス</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">組織</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">スペース</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">ステータス</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">最終使用</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">作成日</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {keys?.map((k) => (
                <tr key={k.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{k.name}</td>
                  <td className="px-4 py-2.5 text-xs font-mono text-gray-600">{k.key_prefix}...</td>
                  <td className="px-4 py-2.5 text-gray-600">{orgMap.get(k.org_id) ?? '-'}</td>
                  <td className="px-4 py-2.5 text-gray-600">{spaceMap.get(k.space_id) ?? '-'}</td>
                  <td className="px-4 py-2.5">
                    {k.is_active
                      ? <AdminBadge variant="success">アクティブ</AdminBadge>
                      : <AdminBadge variant="default">無効</AdminBadge>
                    }
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString('ja-JP') : '未使用'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {new Date(k.created_at).toLocaleDateString('ja-JP')}
                  </td>
                </tr>
              ))}
              {(!keys || keys.length === 0) && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">APIキーがありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
