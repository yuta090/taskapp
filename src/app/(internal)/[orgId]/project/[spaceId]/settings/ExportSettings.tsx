'use client'

import { useState, useEffect, useMemo } from 'react'
import { DownloadSimple, Spinner, Pencil, Check, X, Trash, Plus } from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

interface ExportSettingsProps {
  spaceId: string
}

// デフォルトヘッダー設定
const DEFAULT_HEADERS: Record<string, string> = {
  id: 'ID',
  title: 'タイトル',
  description: '説明',
  type: 'タイプ',
  status: 'ステータス',
  priority: '優先度',
  due_date: '期限',
  ball: 'ボール',
  origin: '起案元',
  assignee: '担当者',
  milestone: 'マイルストーン',
  spec_path: '仕様パス',
  decision_state: '決定状態',
  created_at: '作成日時',
  updated_at: '更新日時',
}

const DEFAULT_COLUMNS = [
  'id', 'title', 'description', 'type', 'status', 'priority',
  'due_date', 'ball', 'origin', 'assignee', 'milestone',
  'spec_path', 'decision_state', 'created_at', 'updated_at'
]

interface ExportTemplate {
  id: string
  name: string
  headers: Record<string, string>
  columns: string[]
  is_default: boolean
}

export function ExportSettings({ spaceId }: ExportSettingsProps) {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // テンプレート関連
  const [templates, setTemplates] = useState<ExportTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // 編集モード
  const [isEditing, setIsEditing] = useState(false)
  const [editingHeaders, setEditingHeaders] = useState<Record<string, string>>({ ...DEFAULT_HEADERS })
  const [editingColumns, setEditingColumns] = useState<string[]>([...DEFAULT_COLUMNS])
  const [editingName, setEditingName] = useState('default')
  const [saving, setSaving] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  // テンプレート一覧を取得
  useEffect(() => {
    async function fetchTemplates() {
      const { data, error } = await (supabase as SupabaseClient)
        .from('export_templates')
        .select('*')
        .eq('space_id', spaceId)
        .order('created_at', { ascending: true })

      if (error) {
        console.error('Failed to fetch templates:', error)
      } else {
        setTemplates(data || [])
        // デフォルトテンプレートがあれば選択
        const defaultTemplate = (data || []).find((t: ExportTemplate) => t.is_default)
        if (defaultTemplate) {
          setSelectedTemplateId(defaultTemplate.id)
        }
      }
      setLoading(false)
    }

    fetchTemplates()
  }, [supabase, spaceId])

  // 選択されたテンプレートの情報を取得
  const selectedTemplate = useMemo(() => {
    return templates.find(t => t.id === selectedTemplateId)
  }, [templates, selectedTemplateId])

  // 編集開始
  const handleStartEdit = () => {
    if (selectedTemplate) {
      setEditingHeaders({ ...DEFAULT_HEADERS, ...selectedTemplate.headers })
      setEditingColumns([...selectedTemplate.columns])
      setEditingName(selectedTemplate.name)
    } else {
      setEditingHeaders({ ...DEFAULT_HEADERS })
      setEditingColumns([...DEFAULT_COLUMNS])
      setEditingName('default')
    }
    setIsEditing(true)
    setError(null)
    setSuccess(null)
  }

  // 編集キャンセル
  const handleCancelEdit = () => {
    setIsEditing(false)
    setError(null)
  }

  // ヘッダー名変更
  const handleHeaderChange = (column: string, value: string) => {
    setEditingHeaders(prev => ({ ...prev, [column]: value }))
  }

  // カラムの表示/非表示切り替え
  const handleColumnToggle = (column: string) => {
    setEditingColumns(prev => {
      if (prev.includes(column)) {
        return prev.filter(c => c !== column)
      } else {
        // 元の順序を維持
        const newColumns = [...prev]
        const originalIndex = DEFAULT_COLUMNS.indexOf(column)
        let insertIndex = newColumns.length
        for (let i = 0; i < newColumns.length; i++) {
          if (DEFAULT_COLUMNS.indexOf(newColumns[i]) > originalIndex) {
            insertIndex = i
            break
          }
        }
        newColumns.splice(insertIndex, 0, column)
        return newColumns
      }
    })
  }

  // テンプレート保存
  const handleSaveTemplate = async () => {
    setSaving(true)
    setError(null)

    try {
      if (selectedTemplateId) {
        // 既存テンプレートを更新
        const { error } = await (supabase as SupabaseClient)
          .from('export_templates')
          .update({
            name: editingName,
            headers: editingHeaders,
            columns: editingColumns,
          })
          .eq('id', selectedTemplateId)

        if (error) throw error

        setTemplates(prev => prev.map(t =>
          t.id === selectedTemplateId
            ? { ...t, name: editingName, headers: editingHeaders, columns: editingColumns }
            : t
        ))
      } else {
        // 新規テンプレート作成
        const { data, error } = await (supabase as SupabaseClient)
          .from('export_templates')
          .insert({
            space_id: spaceId,
            name: editingName,
            headers: editingHeaders,
            columns: editingColumns,
            is_default: templates.length === 0, // 最初のテンプレートはデフォルト
          })
          .select()
          .single()

        if (error) throw error

        setTemplates(prev => [...prev, data])
        setSelectedTemplateId(data.id)
      }

      setIsEditing(false)
      setSuccess('テンプレートを保存しました')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  // テンプレート削除
  const handleDeleteTemplate = async () => {
    if (!selectedTemplateId) return
    if (!confirm('このテンプレートを削除しますか？')) return

    try {
      const { error } = await (supabase as SupabaseClient)
        .from('export_templates')
        .delete()
        .eq('id', selectedTemplateId)

      if (error) throw error

      setTemplates(prev => prev.filter(t => t.id !== selectedTemplateId))
      setSelectedTemplateId(null)
      setSuccess('テンプレートを削除しました')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました')
    }
  }

  // 新規テンプレート作成
  const handleCreateNew = () => {
    setSelectedTemplateId(null)
    setEditingHeaders({ ...DEFAULT_HEADERS })
    setEditingColumns([...DEFAULT_COLUMNS])
    setEditingName('新規テンプレート')
    setIsEditing(true)
    setError(null)
    setSuccess(null)
  }

  // デフォルトに設定
  const handleSetDefault = async () => {
    if (!selectedTemplateId) return

    try {
      // まず全てのis_defaultをfalseに
      const { error: resetError } = await (supabase as SupabaseClient)
        .from('export_templates')
        .update({ is_default: false })
        .eq('space_id', spaceId)

      if (resetError) throw resetError

      // 選択したテンプレートをデフォルトに
      const { error } = await (supabase as SupabaseClient)
        .from('export_templates')
        .update({ is_default: true })
        .eq('id', selectedTemplateId)

      if (error) throw error

      setTemplates(prev => prev.map(t => ({
        ...t,
        is_default: t.id === selectedTemplateId
      })))
      setSuccess('デフォルトに設定しました')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '設定に失敗しました')
    }
  }

  // エクスポート実行
  const handleExport = async () => {
    setExporting(true)
    setError(null)

    try {
      let url = `/api/export/tasks?spaceId=${spaceId}`
      if (selectedTemplateId) {
        url += `&templateId=${selectedTemplateId}`
      }

      const response = await fetch(url)

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'エクスポートに失敗しました')
      }

      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)

      const contentDisposition = response.headers.get('Content-Disposition')
      let filename = 'tasks.csv'
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/)
        if (match) {
          filename = decodeURIComponent(match[1])
        }
      }

      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(downloadUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エクスポートに失敗しました')
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div>
        <h2 className="text-sm font-semibold text-gray-900 mb-4">データエクスポート</h2>
        <div className="text-sm text-gray-400">読み込み中...</div>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-900 mb-4">データエクスポート</h2>

      <div className="space-y-6">
        {/* テンプレート選択 */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-2">
            エクスポートテンプレート
          </label>
          <div className="flex items-center gap-2">
            <select
              value={selectedTemplateId || ''}
              onChange={(e) => setSelectedTemplateId(e.target.value || null)}
              disabled={isEditing}
              className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
            >
              <option value="">デフォルト設定</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} {template.is_default ? '(デフォルト)' : ''}
                </option>
              ))}
            </select>
            {!isEditing && (
              <>
                <button
                  onClick={handleCreateNew}
                  className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                  title="新規テンプレート"
                >
                  <Plus className="text-base" />
                </button>
                {selectedTemplateId && (
                  <>
                    <button
                      onClick={handleStartEdit}
                      className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                      title="編集"
                    >
                      <Pencil className="text-base" />
                    </button>
                    <button
                      onClick={handleDeleteTemplate}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="削除"
                    >
                      <Trash className="text-base" />
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* デフォルト設定ボタン */}
        {selectedTemplateId && !selectedTemplate?.is_default && !isEditing && (
          <button
            onClick={handleSetDefault}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            このテンプレートをデフォルトに設定
          </button>
        )}

        {/* 編集モード */}
        {isEditing && (
          <div className="border border-gray-200 rounded-lg p-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                テンプレート名
              </label>
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="テンプレート名"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">
                カラム設定
              </label>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {DEFAULT_COLUMNS.map((column) => (
                  <div
                    key={column}
                    className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg"
                  >
                    <input
                      type="checkbox"
                      checked={editingColumns.includes(column)}
                      onChange={() => handleColumnToggle(column)}
                      className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <span className="text-xs text-gray-500 w-24">{column}</span>
                    <input
                      type="text"
                      value={editingHeaders[column] || ''}
                      onChange={(e) => handleHeaderChange(column, e.target.value)}
                      disabled={!editingColumns.includes(column)}
                      className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                      placeholder="ヘッダー名"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handleSaveTemplate}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Spinner className="text-base animate-spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Check weight="bold" className="text-base" />
                    保存
                  </>
                )}
              </button>
              <button
                onClick={handleCancelEdit}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                <X weight="bold" className="text-base" />
                キャンセル
              </button>
            </div>
          </div>
        )}

        {/* エクスポートボタン */}
        {!isEditing && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">
              タスク一覧
            </label>
            <p className="text-xs text-gray-400 mb-3">
              このプロジェクトのタスクをCSV形式でエクスポートします。
            </p>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {exporting ? (
                <>
                  <Spinner className="text-base animate-spin" />
                  エクスポート中...
                </>
              ) : (
                <>
                  <DownloadSimple className="text-base" />
                  CSVをダウンロード
                </>
              )}
            </button>
          </div>
        )}

        {/* メッセージ表示 */}
        {error && (
          <div className="text-sm text-red-500">{error}</div>
        )}
        {success && (
          <div className="text-sm text-green-600">{success}</div>
        )}

        {/* API説明 */}
        <div className="pt-4 border-t border-gray-200">
          <p className="text-xs text-gray-400 mb-2">
            APIから直接エクスポートする場合:
          </p>
          <code className="block text-xs bg-gray-100 p-2 rounded font-mono break-all">
            GET /api/export/tasks?spaceId={spaceId}
            {selectedTemplateId && `&templateId=${selectedTemplateId}`}
          </code>
          <p className="text-xs text-gray-400 mt-2">
            カスタムヘッダー: <code className="bg-gray-100 px-1 rounded">{'headers={"id":"ID番号"}'}</code>
          </p>
          <p className="text-xs text-gray-400">
            カラム指定: <code className="bg-gray-100 px-1 rounded">columns=id,title,status</code>
          </p>
        </div>
      </div>
    </div>
  )
}
