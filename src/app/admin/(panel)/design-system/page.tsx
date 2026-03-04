import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'
import { AdminStatCard } from '@/components/admin/AdminStatCard'

const COLORS = [
  { name: 'Gray 50', value: '#F9FAFB', text: 'text-gray-900' },
  { name: 'Gray 100', value: '#F3F4F6', text: 'text-gray-900' },
  { name: 'Gray 200', value: '#E5E7EB', text: 'text-gray-900' },
  { name: 'Gray 300', value: '#D1D5DB', text: 'text-gray-900' },
  { name: 'Gray 500', value: '#6B7280', text: 'text-white' },
  { name: 'Gray 700', value: '#374151', text: 'text-white' },
  { name: 'Gray 900', value: '#111827', text: 'text-white' },
  { name: 'Amber 500', value: '#F59E0B', text: 'text-white' },
  { name: 'Indigo 600', value: '#4F46E5', text: 'text-white' },
  { name: 'Red 500', value: '#EF4444', text: 'text-white' },
  { name: 'Blue 500', value: '#3B82F6', text: 'text-white' },
  { name: 'Green 500', value: '#22C55E', text: 'text-white' },
]

const FONT_SIZES = [
  { name: '2xs', size: '10px', class: 'text-2xs' },
  { name: 'xs', size: '12px', class: 'text-xs' },
  { name: 'sm', size: '13px', class: 'text-sm' },
  { name: 'base', size: '14px', class: 'text-base' },
  { name: 'lg', size: '16px', class: 'text-lg' },
  { name: 'xl', size: '20px', class: 'text-xl' },
  { name: '2xl', size: '24px', class: 'text-2xl' },
]

export default function AdminDesignSystemPage() {
  return (
    <div className="p-6 max-w-5xl">
      <AdminPageHeader
        title="デザインシステム"
        description="TaskApp で使用しているカラー・タイポグラフィ・コンポーネント"
      />

      {/* Colors */}
      <section className="mb-10">
        <h2 className="text-sm font-medium text-gray-700 mb-3">カラーパレット</h2>
        <div className="grid grid-cols-4 lg:grid-cols-6 gap-3">
          {COLORS.map((c) => (
            <div key={c.name} className="rounded-xl overflow-hidden border border-gray-200">
              <div
                className={`h-16 flex items-end p-2 ${c.text}`}
                style={{ backgroundColor: c.value }}
              >
                <span className="text-xs font-medium">{c.name}</span>
              </div>
              <div className="bg-white px-2 py-1.5">
                <span className="text-xs font-mono text-gray-500">{c.value}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-sm text-amber-800">
            <strong>Amber-500</strong> はクライアントに見える要素を示す色です。管理パネルでは <strong>Indigo-600</strong> をプライマリとして使用。
          </p>
        </div>
      </section>

      {/* Typography */}
      <section className="mb-10">
        <h2 className="text-sm font-medium text-gray-700 mb-3">タイポグラフィ</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          {FONT_SIZES.map((f) => (
            <div key={f.name} className="flex items-baseline gap-4">
              <span className="text-xs text-gray-400 w-16 shrink-0 font-mono">{f.name} ({f.size})</span>
              <span className={f.class + ' text-gray-900'}>
                TaskApp 管理パネル The quick brown fox
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Badges */}
      <section className="mb-10">
        <h2 className="text-sm font-medium text-gray-700 mb-3">バッジ</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex flex-wrap gap-3">
            <AdminBadge variant="default">default</AdminBadge>
            <AdminBadge variant="success">success</AdminBadge>
            <AdminBadge variant="warning">warning</AdminBadge>
            <AdminBadge variant="danger">danger</AdminBadge>
            <AdminBadge variant="info">info</AdminBadge>
            <AdminBadge variant="indigo">indigo</AdminBadge>
          </div>
        </div>
      </section>

      {/* Stat Cards */}
      <section className="mb-10">
        <h2 className="text-sm font-medium text-gray-700 mb-3">統計カード</h2>
        <div className="grid grid-cols-3 gap-4">
          <AdminStatCard label="サンプルラベル" value={1234} sub="前月比 +12%" />
          <AdminStatCard label="パーセンテージ" value="85%" />
          <AdminStatCard label="テキスト値" value="正常" />
        </div>
      </section>

      {/* Buttons */}
      <section className="mb-10">
        <h2 className="text-sm font-medium text-gray-700 mb-3">ボタン</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex flex-wrap gap-3">
            <button className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors">
              プライマリ
            </button>
            <button className="px-3 py-1.5 bg-white text-gray-700 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors">
              セカンダリ
            </button>
            <button className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors">
              デンジャー
            </button>
            <button className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg opacity-50 cursor-not-allowed" disabled>
              無効
            </button>
          </div>
        </div>
      </section>

      {/* Shadows */}
      <section className="mb-10">
        <h2 className="text-sm font-medium text-gray-700 mb-3">シャドウ</h2>
        <div className="grid grid-cols-3 gap-6 p-6">
          <div className="bg-white rounded-xl p-6 shadow-subtle border border-gray-100">
            <p className="text-sm font-medium">shadow-subtle</p>
            <p className="text-xs text-gray-500 mt-1">カード、バッジ</p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-popover">
            <p className="text-sm font-medium">shadow-popover</p>
            <p className="text-xs text-gray-500 mt-1">ドロップダウン、ポップオーバー</p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-modal">
            <p className="text-sm font-medium">shadow-modal</p>
            <p className="text-xs text-gray-500 mt-1">モーダル、ダイアログ</p>
          </div>
        </div>
      </section>

      {/* Layout Rules */}
      <section className="mb-10">
        <h2 className="text-sm font-medium text-gray-700 mb-3">レイアウトルール</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="space-y-3 text-sm text-gray-700">
            <p><strong>3ペインレイアウト (メインアプリ):</strong> LeftNav 240px | Main flex-1 | Inspector 400px</p>
            <p><strong>管理パネル:</strong> AdminSidebar 240px | Main flex-1 (Inspector なし)</p>
            <p><strong>Inspector は常にリサイズ</strong> — オーバーレイ禁止</p>
            <p><strong>Optimistic updates 必須</strong> — 保存ボタンなし</p>
            <p><strong>Amber-500</strong> = クライアント可視要素のインジケータ</p>
          </div>
        </div>
      </section>
    </div>
  )
}
