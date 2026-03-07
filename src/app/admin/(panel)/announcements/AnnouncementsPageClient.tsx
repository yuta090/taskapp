'use client'

import { useCallback, useState } from 'react'
import { Plus, Trash, Megaphone, Bell, Wrench, WarningCircle } from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AnnouncementRow {
  id: string
  org_id: string | null
  org_name: string | null
  title: string
  body: string
  category: 'info' | 'feature' | 'maintenance' | 'important'
  published: boolean
  created_at: string
  read_count: number
}

export interface OrgOption {
  id: string
  name: string
}

const CATEGORY_OPTIONS = [
  { value: 'info', label: 'お知らせ', icon: Bell, color: 'text-blue-500 bg-blue-50' },
  { value: 'feature', label: '新機能', icon: Megaphone, color: 'text-indigo-500 bg-indigo-50' },
  { value: 'maintenance', label: 'メンテナンス', icon: Wrench, color: 'text-amber-500 bg-amber-50' },
  { value: 'important', label: '重要', icon: WarningCircle, color: 'text-red-500 bg-red-50' },
] as const

type Category = typeof CATEGORY_OPTIONS[number]['value']

function getCategoryConfig(cat: string) {
  return CATEGORY_OPTIONS.find((c) => c.value === cat) ?? CATEGORY_OPTIONS[0]
}

interface CreateFormProps {
  orgs: OrgOption[]
  onCreated: (row: AnnouncementRow) => void
}

function CreateForm({ orgs, onCreated }: CreateFormProps) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState<Category>('info')
  const [orgId, setOrgId] = useState<string>('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      const supabase = createClient()
      const { data, error } = await (supabase as SupabaseClient)
        .from('announcements')
        .insert({
          title: title.trim(),
          body: body.trim(),
          category,
          org_id: orgId || null,
        })
        .select('id, org_id, title, body, category, published, created_at')
        .single()

      if (error) throw error

      const orgName = orgId ? orgs.find((o) => o.id === orgId)?.name ?? null : null
      onCreated({
        ...(data as Omit<AnnouncementRow, 'org_name' | 'read_count'>),
        org_name: orgName,
        read_count: 0,
      })
      setTitle('')
      setBody('')
      setCategory('info')
      setOrgId('')
      setOpen(false)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }, [title, body, category, orgId, saving, orgs, onCreated])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
      >
        <Plus size={16} weight="bold" />
        新規作成
      </button>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">お知らせを作成</h3>
      <div className="space-y-3">
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">タイトル *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: v2.0をリリースしました"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div className="w-36">
            <label className="block text-xs font-medium text-gray-600 mb-1">カテゴリ</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="w-48">
            <label className="block text-xs font-medium text-gray-600 mb-1">対象組織</label>
            <select
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">全組織（システム共通）</option>
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">本文</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="詳細な説明（任意）"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setOpen(false)}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || saving}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? '作成中...' : '作成'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface Props {
  initialData: AnnouncementRow[]
  orgs: OrgOption[]
}

export default function AnnouncementsPageClient({ initialData, orgs }: Props) {
  const [rows, setRows] = useState(initialData)
  const [deleting, setDeleting] = useState<string | null>(null)

  const handleCreated = useCallback((row: AnnouncementRow) => {
    setRows((prev) => [row, ...prev])
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('このお知らせを削除しますか？')) return
    setDeleting(id)
    try {
      const supabase = createClient()
      const { error } = await (supabase as SupabaseClient)
        .from('announcements')
        .delete()
        .eq('id', id)

      if (error) throw error
      setRows((prev) => prev.filter((r) => r.id !== id))
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '削除に失敗しました')
    } finally {
      setDeleting(null)
    }
  }, [])

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900">お知らせ管理</h1>
          <p className="text-sm text-gray-500 mt-0.5">ユーザー向けのお知らせを発行・管理</p>
        </div>
        <CreateForm orgs={orgs} onCreated={handleCreated} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {CATEGORY_OPTIONS.map((opt) => {
          const count = rows.filter((r) => r.category === opt.value).length
          const Icon = opt.icon
          return (
            <div key={opt.value} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${opt.color}`}>
                <Icon size={18} weight="duotone" />
              </div>
              <div>
                <p className="text-xs text-gray-500">{opt.label}</p>
                <p className="text-lg font-bold text-gray-900">{count}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">カテゴリ</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">タイトル</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">対象</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">既読数</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">作成日</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                    お知らせはまだありません
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const config = getCategoryConfig(row.category)
                  const Icon = config.icon
                  return (
                    <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded ${config.color}`}>
                          <Icon size={14} />
                          {config.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-sm font-medium text-gray-900 truncate max-w-[300px]">{row.title}</p>
                        {row.body && (
                          <p className="text-xs text-gray-500 truncate max-w-[300px]">{row.body}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-600">
                        {row.org_name ?? '全組織'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-600">
                        {row.read_count}人
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString('ja-JP')}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => handleDelete(row.id)}
                          disabled={deleting === row.id}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
                          title="削除"
                        >
                          <Trash size={16} />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
