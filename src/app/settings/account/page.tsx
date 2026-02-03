'use client'

import { useState, useEffect, useMemo } from 'react'
import { ArrowLeft, User, Camera, Check, CircleNotch } from '@phosphor-icons/react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'

export default function AccountSettingsPage() {
  const { user, loading: userLoading } = useCurrentUser()
  const [displayName, setDisplayName] = useState('')
  const [originalDisplayName, setOriginalDisplayName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const supabase = useMemo(() => createClient(), [])

  // Fetch profile data
  useEffect(() => {
    // If user loading is done and no user, stop loading
    if (!userLoading && !user) {
      setLoading(false)
      return
    }
    if (!user) return

    const fetchProfile = async () => {
      setLoading(true)
      try {
        const { data, error } = await (supabase as any)
          .from('profiles')
          .select('display_name, avatar_url')
          .eq('id', user.id)
          .maybeSingle()  // Use maybeSingle to handle missing profile gracefully

        if (error) throw error

        if (data) {
          setDisplayName(data.display_name || '')
          setOriginalDisplayName(data.display_name || '')
          setAvatarUrl(data.avatar_url || null)
        } else {
          // Profile doesn't exist yet - use defaults from user metadata
          const defaultName = user.user_metadata?.name || user.email?.split('@')[0] || ''
          setDisplayName(defaultName)
          setOriginalDisplayName('')  // Empty so hasChanges triggers
        }
      } catch (err) {
        console.error('Failed to fetch profile:', err)
        setMessage({ type: 'error', text: 'プロフィールの取得に失敗しました' })
      } finally {
        setLoading(false)
      }
    }

    void fetchProfile()
  }, [user, userLoading, supabase])

  const handleSave = async () => {
    if (!user || !displayName.trim()) return

    setSaving(true)
    setMessage(null)

    try {
      // Use upsert to handle both new and existing profiles
      const { data, error } = await (supabase as any)
        .from('profiles')
        .upsert({
          id: user.id,
          display_name: displayName.trim(),
        })
        .select()
        .single()

      if (error) throw error

      if (!data) {
        throw new Error('Update returned no data')
      }

      setOriginalDisplayName(displayName.trim())
      setMessage({ type: 'success', text: 'プロフィールを更新しました' })
    } catch (err) {
      console.error('Failed to update profile:', err)
      setMessage({ type: 'error', text: 'プロフィールの更新に失敗しました' })
    } finally {
      setSaving(false)
    }
  }

  const hasChanges = displayName.trim() !== originalDisplayName

  if (userLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <CircleNotch className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">ログインが必要です</p>
          <Link href="/login" className="text-indigo-600 hover:underline">
            ログインページへ
          </Link>
        </div>
      </div>
    )
  }

  const userInitial = (displayName || user.email || 'U').charAt(0).toUpperCase()

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
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
              <h1 className="text-xl font-semibold text-gray-900">アカウント設定</h1>
              <p className="text-sm text-gray-500">プロフィール情報の編集</p>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
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

        {/* Profile Card */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
          {/* Avatar */}
          <div className="flex items-center gap-6">
            <div className="relative">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Avatar"
                  className="w-20 h-20 rounded-full object-cover"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-2xl font-bold">
                  {userInitial}
                </div>
              )}
              <button
                type="button"
                className="absolute bottom-0 right-0 p-1.5 bg-white border border-gray-200 rounded-full shadow-sm hover:bg-gray-50 transition-colors"
                title="アバターを変更（準備中）"
                disabled
              >
                <Camera className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div>
              <p className="text-sm text-gray-500">プロフィール画像</p>
              <p className="text-xs text-gray-400 mt-1">画像アップロードは準備中です</p>
            </div>
          </div>

          {/* Display Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <User className="inline-block w-4 h-4 mr-1" />
              表示名
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="表示名を入力"
              maxLength={50}
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              この名前がタスクの担当者欄などに表示されます
            </p>
          </div>

          {/* Email (read-only) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              メールアドレス
            </label>
            <input
              type="email"
              value={user.email || ''}
              disabled
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
            />
            <p className="text-xs text-gray-500 mt-1">
              メールアドレスの変更はサポートまでお問い合わせください
            </p>
          </div>

          {/* Save Button */}
          <div className="flex justify-end pt-4 border-t border-gray-100">
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving || !displayName.trim()}
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
        </div>

        {/* Account Info */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-900 mb-4">アカウント情報</h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">ユーザーID</dt>
              <dd className="text-gray-700 font-mono text-xs">{user.id.slice(0, 8)}...</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">作成日</dt>
              <dd className="text-gray-700">
                {user.created_at
                  ? new Date(user.created_at).toLocaleDateString('ja-JP')
                  : '-'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">最終ログイン</dt>
              <dd className="text-gray-700">
                {user.last_sign_in_at
                  ? new Date(user.last_sign_in_at).toLocaleDateString('ja-JP')
                  : '-'}
              </dd>
            </div>
          </dl>
        </div>
      </main>
    </div>
  )
}
