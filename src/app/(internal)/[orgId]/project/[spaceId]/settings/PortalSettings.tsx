'use client'

import { useCallback } from 'react'
import { toast } from 'sonner'
import { usePortalVisibility, type PortalVisibleSections } from '@/lib/hooks/usePortalVisibility'

interface PortalSettingsProps {
  spaceId: string
}

interface ToggleItemProps {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function ToggleItem({ label, description, checked, onChange }: ToggleItemProps) {
  return (
    <label className="flex items-start gap-3 py-3 px-1 cursor-pointer group">
      <div className="pt-0.5">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            checked ? 'bg-indigo-600' : 'bg-gray-200'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
              checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`}
          />
        </button>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900">{label}</div>
        <div className="text-xs text-gray-500 mt-0.5">{description}</div>
      </div>
    </label>
  )
}

const SECTION_CONFIG: { key: keyof PortalVisibleSections; label: string; description: string }[] = [
  { key: 'tasks', label: '要対応', description: 'クライアントがボールを持っているタスクの一覧' },
  { key: 'requests', label: '送信リクエスト', description: 'クライアントが送信したバグ報告・要望' },
  { key: 'all_tasks', label: 'タスク一覧', description: '公開対象の全タスク一覧' },
  { key: 'files', label: 'ファイル', description: '共有ファイルの閲覧' },
  { key: 'meetings', label: '議事録', description: '会議の議事録と決定事項' },
  { key: 'wiki', label: 'Wiki', description: 'プロジェクトのWikiドキュメント' },
  { key: 'history', label: '承認履歴', description: '過去の承認・レビュー履歴' },
]

export function PortalSettings({ spaceId }: PortalSettingsProps) {
  const { sections, loading, updateSections } = usePortalVisibility(spaceId)

  const handleToggle = useCallback(
    async (key: keyof PortalVisibleSections, checked: boolean) => {
      const updated = { ...sections, [key]: checked }
      try {
        await updateSections(updated)
        toast.success('ポータル表示設定を更新しました')
      } catch {
        toast.error('設定の更新に失敗しました')
      }
    },
    [sections, updateSections]
  )

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-4 bg-gray-100 rounded w-1/3" />
        <div className="h-10 bg-gray-50 rounded" />
        <div className="h-10 bg-gray-50 rounded" />
        <div className="h-10 bg-gray-50 rounded" />
      </div>
    )
  }

  return (
    <div>
      <h3 className="text-base font-semibold text-gray-900 mb-1">ポータル表示設定</h3>
      <p className="text-xs text-gray-500 mb-4">
        クライアントポータルに表示するセクションを選択します。非表示にしたセクションはポータルのナビゲーションに表示されません。
      </p>

      <div className="divide-y divide-gray-100">
        {SECTION_CONFIG.map((item) => (
          <ToggleItem
            key={item.key}
            label={item.label}
            description={item.description}
            checked={sections[item.key]}
            onChange={(checked) => handleToggle(item.key, checked)}
          />
        ))}
      </div>

      <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <p className="text-xs text-amber-800">
          ダッシュボードと設定は常に表示されます。変更はポータルに即座に反映されます。
        </p>
      </div>
    </div>
  )
}
