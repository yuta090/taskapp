'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'

export interface CtaRow {
  id: string
  key: string
  name: string
  heading: string
  body: string | null
  button_label: string
  button_url: string
  variant: 'inline' | 'band' | 'card'
  enabled: boolean
  updated_at: string
}

const BLANK: Omit<CtaRow, 'id' | 'updated_at'> = {
  key: '',
  name: '',
  heading: '',
  body: '',
  button_label: '',
  button_url: '/contact',
  variant: 'band',
  enabled: true,
}

export default function CtaListClient({ initialData }: { initialData: CtaRow[] }) {
  const router = useRouter()
  const [rows, setRows] = useState<CtaRow[]>(initialData)
  const [editing, setEditing] = useState<Partial<CtaRow> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!editing) return
    setSaving(true)
    setError(null)
    const isNew = !editing.id
    const res = await fetch('/api/admin/blog/cta', {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editing),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      setError(data.error ?? '保存に失敗しました')
      return
    }
    setEditing(null)
    router.refresh()
    // 楽観反映
    if (data.cta) {
      setRows((prev) => {
        const others = prev.filter((r) => r.id !== data.cta.id)
        return [...others, data.cta].sort((a, b) => a.name.localeCompare(b.name))
      })
    }
  }

  async function remove(id: string) {
    if (!confirm('このCTAを削除しますか？（記事の参照は自動で外れます）')) return
    const res = await fetch(`/api/admin/blog/cta?id=${id}`, { method: 'DELETE' })
    if (res.ok) {
      setRows((prev) => prev.filter((r) => r.id !== id))
      router.refresh()
    } else {
      setError('削除に失敗しました')
    }
  }

  return (
    <div className="p-6 max-w-5xl">
      <AdminPageHeader
        title="CTA管理"
        description="記事に差し込むCTAブロック。文言・リンク先をここで変えると、参照している記事すべてに反映されます。"
        actions={
          <div className="flex gap-2">
            <Link
              href="/admin/blog"
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              ← 記事一覧
            </Link>
            <button
              onClick={() => setEditing({ ...BLANK })}
              className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              新規CTA
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      {editing && (
        <div className="mb-6 rounded-xl border border-gray-200 p-4 bg-gray-50">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="key（英小文字・数字・ハイフン）">
              <input
                value={editing.key ?? ''}
                onChange={(e) => setEditing((s) => ({ ...s, key: e.target.value }))}
                className="input font-mono"
                disabled={!!editing.id}
              />
            </Field>
            <Field label="管理名">
              <input
                value={editing.name ?? ''}
                onChange={(e) => setEditing((s) => ({ ...s, name: e.target.value }))}
                className="input"
              />
            </Field>
            <Field label="見出し">
              <input
                value={editing.heading ?? ''}
                onChange={(e) => setEditing((s) => ({ ...s, heading: e.target.value }))}
                className="input"
              />
            </Field>
            <Field label="補足文（任意）">
              <input
                value={editing.body ?? ''}
                onChange={(e) => setEditing((s) => ({ ...s, body: e.target.value }))}
                className="input"
              />
            </Field>
            <Field label="ボタン文言">
              <input
                value={editing.button_label ?? ''}
                onChange={(e) => setEditing((s) => ({ ...s, button_label: e.target.value }))}
                className="input"
              />
            </Field>
            <Field label="リンク先（/ か https://）">
              <input
                value={editing.button_url ?? ''}
                onChange={(e) => setEditing((s) => ({ ...s, button_url: e.target.value }))}
                className="input"
              />
            </Field>
            <Field label="表示スタイル">
              <select
                value={editing.variant ?? 'band'}
                onChange={(e) =>
                  setEditing((s) => ({ ...s, variant: e.target.value as CtaRow['variant'] }))
                }
                className="input"
              >
                <option value="inline">inline（本文中の補足調）</option>
                <option value="band">band（帯）</option>
                <option value="card">card（カード）</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-gray-700 mt-6">
              <input
                type="checkbox"
                checked={editing.enabled !== false}
                onChange={(e) => setEditing((s) => ({ ...s, enabled: e.target.checked }))}
              />
              有効
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              保存
            </button>
            <button
              onClick={() => setEditing(null)}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-white"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="text-sm text-gray-400">CTAがありません。「新規CTA」から追加してください。</p>
        )}
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm text-gray-900">{r.name}</span>
                <code className="text-xs text-gray-400">{r.key}</code>
                <AdminBadge variant={r.enabled ? 'success' : 'default'}>
                  {r.enabled ? '有効' : '無効'}
                </AdminBadge>
                <AdminBadge variant="info">{r.variant}</AdminBadge>
              </div>
              <div className="text-xs text-gray-500 truncate">
                {r.button_label} → {r.button_url}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => setEditing(r)}
                className="text-indigo-600 hover:text-indigo-800 text-sm"
              >
                編集
              </button>
              <button
                onClick={() => remove(r.id)}
                className="text-red-500 hover:text-red-700 text-sm"
              >
                削除
              </button>
            </div>
          </div>
        ))}
      </div>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid #d1d5db;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
      `}</style>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
