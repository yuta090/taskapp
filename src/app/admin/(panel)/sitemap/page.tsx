import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

const ROUTES = [
  {
    group: '認証',
    routes: [
      { path: '/login', description: 'ログイン' },
      { path: '/signup', description: '新規登録' },
      { path: '/reset', description: 'パスワードリセット' },
      { path: '/invite/:token', description: '招待受諾' },
      { path: '/auth/callback', description: 'OAuth コールバック' },
      { path: '/onboarding', description: '初期セットアップ' },
    ],
  },
  {
    group: 'ランディングページ',
    routes: [
      { path: '/', description: 'トップページ' },
      { path: '/docs', description: 'ドキュメント' },
      { path: '/contact', description: 'お問い合わせ' },
    ],
  },
  {
    group: '内部 (認証必須)',
    routes: [
      { path: '/inbox', description: '受信トレイ' },
      { path: '/my/*', description: 'マイページ' },
      { path: '/settings/organization', description: '組織設定' },
      { path: '/settings/members', description: 'メンバー管理' },
      { path: '/settings/billing', description: '課金・プラン' },
      { path: '/:orgId/project/:spaceId', description: 'プロジェクトタスク一覧' },
      { path: '/:orgId/project/:spaceId/meetings', description: 'ミーティング一覧' },
      { path: '/:orgId/project/:spaceId/wiki', description: 'Wiki' },
      { path: '/:orgId/project/:spaceId/scheduling', description: 'スケジュール調整' },
      { path: '/:orgId/project/:spaceId/views/gantt', description: 'ガントチャート' },
      { path: '/:orgId/project/:spaceId/views/burndown', description: 'バーンダウンチャート' },
      { path: '/:orgId/project/:spaceId/settings', description: 'スペース設定' },
    ],
  },
  {
    group: 'クライアントポータル',
    routes: [
      { path: '/portal', description: 'ポータルダッシュボード' },
      { path: '/portal/:spaceId', description: 'プロジェクト詳細' },
      { path: '/portal/scheduling', description: 'スケジュール回答' },
    ],
  },
  {
    group: 'API',
    routes: [
      { path: '/api/auth/logout', description: 'ログアウト' },
      { path: '/api/burndown', description: 'バーンダウンデータ' },
      { path: '/api/export/tasks', description: 'タスクCSVエクスポート' },
      { path: '/api/keys', description: 'APIキー CRUD' },
      { path: '/api/invites', description: '招待管理' },
      { path: '/api/scheduling/*', description: 'スケジュール提案' },
      { path: '/api/slack/*', description: 'Slack連携' },
      { path: '/api/github/*', description: 'GitHub連携' },
      { path: '/api/stripe/*', description: 'Stripe課金' },
      { path: '/api/spaces/*', description: 'スペース作成' },
      { path: '/api/admin/users', description: '管理者用ユーザーAPI' },
    ],
  },
  {
    group: '管理者',
    routes: [
      { path: '/admin/login', description: '管理者ログイン' },
      { path: '/admin/dashboard', description: 'ダッシュボード' },
      { path: '/admin/tables', description: 'テーブルブラウザ' },
      { path: '/admin/users', description: 'ユーザー管理' },
      { path: '/admin/organizations', description: '組織管理' },
      { path: '/admin/spaces', description: 'スペース管理' },
      { path: '/admin/invites', description: '招待トラッキング' },
      { path: '/admin/billing', description: '課金状況' },
      { path: '/admin/api-keys', description: 'APIキー管理' },
      { path: '/admin/logs', description: 'ログビューア' },
      { path: '/admin/notifications', description: '通知状況' },
      { path: '/admin/reviews', description: 'レビュー滞留' },
      { path: '/admin/analytics', description: '登録アナリティクス' },
      { path: '/admin/sitemap', description: 'サイトマップ' },
      { path: '/admin/design-system', description: 'デザインシステム' },
    ],
  },
]

export default function AdminSitemapPage() {
  return (
    <div className="p-6 max-w-4xl">
      <AdminPageHeader
        title="サイトマップ"
        description="アプリケーション全ルート一覧"
      />

      <div className="space-y-6">
        {ROUTES.map((group) => (
          <div key={group.group}>
            <h2 className="text-sm font-medium text-gray-700 mb-2">{group.group}</h2>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {group.routes.map((route) => (
                    <tr key={route.path} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-xs text-indigo-600 w-1/2">{route.path}</td>
                      <td className="px-4 py-2 text-gray-600">{route.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
