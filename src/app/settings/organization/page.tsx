'use client'

import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Buildings, Check, CircleNotch, Crown } from '@phosphor-icons/react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/hooks/useCurrentOrg'
import type { SupabaseClient } from '@supabase/supabase-js'

export default function OrganizationSettingsPage() {
  const { orgId, orgName, role, loading: orgLoading } = useCurrentOrg()
  const [editName, setEditName] = useState('')
  const [originalName, setOriginalName] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const isOwner = role === 'owner'

  useEffect(() => {
    if (orgName) {
      setEditName(orgName)
      setOriginalName(orgName)
    }
  }, [orgName])

  const handleSave = async () => {
    if (!orgId || !editName.trim() || !isOwner) return

    setSaving(true)
    setMessage(null)

    try {
      const { error } = await (supabase as SupabaseClient)
        .from('organizations')
        .update({ name: editName.trim() })
        .eq('id', orgId)

      if (error) throw error

      setOriginalName(editName.trim())
      setMessage({ type: 'success', text: '組織名を更新しました' })
    } catch (err: unknown) {
      console.error('Failed to update organization:', err)
      setMessage({ type: 'error', text: '組織名の更新に失敗しました' })
    } finally {
      setSaving(false)
    }
  }

  const hasChanges = editName.trim() !== originalName

  const roleBadge = role === 'owner'
    ? { label: 'オーナー', color: 'bg-indigo-50 text-indigo-700' }
    : role === 'member'
    ? { label: 'メンバー', color: 'bg-gray-100 text-gray-700' }
    : { label: 'クライアント', color: 'bg-amber-50 text-amber-700' }

  if (orgLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <CircleNotch className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/inbox"
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">組織設定</h1>
              <p className="text-sm text-gray-500">組織の基本情報</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Message */}
        {message && (
          <div
            className={`p-4 rounded-lg ${
              message.type === 'success'
                ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Organization Card */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
          {/* Header with icon */}
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-orange-600 rounded-lg flex items-center justify-center">
              <Buildings className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{orgName ?? '未設定'}</h2>
              <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${roleBadge.color}`}>
                {role === 'owner' && <Crown className="inline w-3 h-3 mr-0.5" weight="fill" />}
                {roleBadge.label}
              </span>
            </div>
          </div>

          {/* Organization Name Edit */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              組織名
            </label>
            {isOwner ? (
              <>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="組織名を入力"
                  maxLength={100}
                  className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  この名前がメンバーに表示されます
                </p>
              </>
            ) : (
              <>
                <input
                  type="text"
                  value={orgName ?? ''}
                  disabled
                  className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
                />
                <p className="text-xs text-gray-500 mt-1">
                  組織名の変更はオーナーのみ可能です
                </p>
              </>
            )}
          </div>

          {/* Organization Info */}
          <dl className="space-y-3 text-sm pt-4 border-t border-gray-100">
            <div className="flex justify-between">
              <dt className="text-gray-500">組織ID</dt>
              <dd className="text-gray-700 font-mono text-xs">{orgId ? `${orgId.slice(0, 8)}...` : '-'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">あなたの役割</dt>
              <dd>
                <span className={`text-xs px-2 py-0.5 rounded-full ${roleBadge.color}`}>
                  {roleBadge.label}
                </span>
              </dd>
            </div>
          </dl>

          {/* Save Button (owner only) */}
          {isOwner && (
            <div className="flex justify-end pt-4 border-t border-gray-100">
              <button
                onClick={handleSave}
                disabled={!hasChanges || saving || !editName.trim()}
                className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                {saving ? (
                  <CircleNotch className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
