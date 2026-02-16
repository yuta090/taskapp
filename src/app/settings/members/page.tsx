'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { ArrowLeft, CircleNotch, Users, Crown, Trash, Plus, Warning } from '@phosphor-icons/react'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/hooks/useCurrentOrg'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import type { SupabaseClient } from '@supabase/supabase-js'
import { toast } from 'sonner'

interface MemberRow {
  user_id: string
  role: string
  display_name: string
  email: string | null
  avatar_url: string | null
  joined_at: string
}

const ORG_ROLE_LABELS: Record<string, string> = {
  owner: 'オーナー',
  member: 'メンバー',
  client: 'クライアント',
}

const ORG_ROLE_OPTIONS = [
  { value: 'owner', label: 'オーナー' },
  { value: 'member', label: 'メンバー' },
  { value: 'client', label: 'クライアント' },
]

export default function MembersSettingsPage() {
  const { orgId, role, loading: orgLoading } = useCurrentOrg()
  const { user, loading: userLoading } = useCurrentUser()
  const [members, setMembers] = useState<MemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviting, setInviting] = useState(false)
  const [inviteMessage, setInviteMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const isOwner = role === 'owner'

  const fetchMembers = useCallback(async () => {
    if (!orgId) return

    setLoading(true)
    setError(null)

    try {
      const { data, error: fetchError } = await (supabase as SupabaseClient)
        .rpc('rpc_get_org_members', { p_org_id: orgId })

      if (fetchError) throw fetchError

      const memberList: MemberRow[] = (data || []).map((m: {
        user_id: string
        display_name: string
        avatar_url: string | null
        email: string | null
        role: string
        joined_at: string
      }) => ({
        user_id: m.user_id,
        display_name: m.display_name || 'User',
        email: m.email,
        avatar_url: m.avatar_url,
        role: m.role,
        joined_at: m.joined_at,
      }))

      setMembers(memberList)
    } catch (err: unknown) {
      console.error('Failed to fetch members:', err)
      setError('メンバー情報の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [orgId, supabase])

  useEffect(() => {
    if (orgLoading || userLoading) return
    if (!orgId) {
      setLoading(false)
      return
    }
    void fetchMembers()
  }, [orgId, orgLoading, userLoading, fetchMembers])

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (!isOwner || userId === user?.id || !orgId) return

    const prevMembers = members
    // Optimistic update
    setMembers(prev =>
      prev.map(m => (m.user_id === userId ? { ...m, role: newRole } : m))
    )

    try {
      const { error: updateError } = await (supabase as SupabaseClient)
        .from('org_memberships')
        .update({ role: newRole })
        .eq('org_id', orgId)
        .eq('user_id', userId)

      if (updateError) throw updateError
      toast.success('役割を変更しました')
    } catch (err: unknown) {
      console.error('Failed to update role:', err)
      setMembers(prevMembers) // Rollback
      toast.error('役割の変更に失敗しました')
    }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!isOwner || userId === user?.id || !orgId) return
    if (!confirm('このメンバーを組織から削除しますか？')) return

    const prevMembers = members
    // Optimistic update
    setMembers(prev => prev.filter(m => m.user_id !== userId))

    try {
      const { error: deleteError } = await (supabase as SupabaseClient)
        .from('org_memberships')
        .delete()
        .eq('org_id', orgId)
        .eq('user_id', userId)

      if (deleteError) throw deleteError
      toast.success('メンバーを削除しました')
    } catch (err: unknown) {
      console.error('Failed to remove member:', err)
      setMembers(prevMembers) // Rollback
      toast.error('メンバーの削除に失敗しました')
    }
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !isOwner) return

    setInviting(true)
    setInviteMessage(null)

    try {
      setInviteMessage({
        type: 'success',
        text: `${inviteEmail} への招待メール送信機能は準備中です。直接メンバーを追加する場合は、まずユーザーにアカウント作成を依頼してください。`,
      })
      setInviteEmail('')
    } catch (err: unknown) {
      console.error('Failed to invite member:', err)
      setInviteMessage({ type: 'error', text: 'メンバーの招待に失敗しました' })
    } finally {
      setInviting(false)
    }
  }

  const getRoleBadgeColor = (memberRole: string) => {
    switch (memberRole) {
      case 'owner':
        return 'bg-indigo-50 text-indigo-700'
      case 'member':
        return 'bg-gray-100 text-gray-700'
      case 'client':
        return 'bg-amber-50 text-amber-700'
      default:
        return 'bg-gray-100 text-gray-700'
    }
  }

  if (orgLoading || userLoading || loading) {
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
              <h1 className="text-xl font-semibold text-gray-900">メンバー管理</h1>
              <p className="text-sm text-gray-500">組織のメンバー一覧と管理</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Error */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Members list */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2 text-gray-700">
              <Users className="w-4 h-4" />
              <span className="text-sm font-medium">メンバー</span>
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                {members.length}人
              </span>
            </div>
          </div>

          <div className="divide-y divide-gray-100">
            {members.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500">
                メンバーが見つかりませんでした
              </div>
            ) : (
              members.map(member => {
                const initial = member.display_name.charAt(0).toUpperCase()
                const isCurrentUser = member.user_id === user?.id

                return (
                  <div key={member.user_id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    {/* Avatar */}
                    {member.avatar_url ? (
                      <Image
                        src={member.avatar_url}
                        alt=""
                        width={32}
                        height={32}
                        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                        unoptimized
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-700 text-white flex items-center justify-center text-xs font-medium flex-shrink-0">
                        {initial}
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {member.display_name}
                        </span>
                        {isCurrentUser && (
                          <span className="text-xs text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                            あなた
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {member.email || ''}
                        {member.joined_at && (
                          <span className="ml-2">
                            参加: {new Date(member.joined_at).toLocaleDateString('ja-JP')}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Role */}
                    {isOwner && !isCurrentUser ? (
                      <select
                        value={member.role}
                        onChange={e => handleRoleChange(member.user_id, e.target.value)}
                        className="px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        {ORG_ROLE_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={`px-2 py-1 text-xs rounded flex-shrink-0 ${getRoleBadgeColor(member.role)}`}>
                        {member.role === 'owner' && <Crown className="inline w-3 h-3 mr-1" weight="fill" />}
                        {ORG_ROLE_LABELS[member.role] || member.role}
                      </span>
                    )}

                    {/* Delete button */}
                    {isOwner && !isCurrentUser && (
                      <button
                        onClick={() => handleRemoveMember(member.user_id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="メンバーを削除"
                      >
                        <Trash className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Invite form (owner only) */}
        {isOwner && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
            <div className="text-xs font-medium text-gray-500">メンバーを招待</div>

            {inviteMessage && (
              <div
                className={`p-3 rounded-lg text-sm ${
                  inviteMessage.type === 'success'
                    ? 'bg-blue-50 border border-blue-200 text-blue-700'
                    : 'bg-red-50 border border-red-200 text-red-700'
                }`}
              >
                <Warning className="inline w-4 h-4 mr-1" />
                {inviteMessage.text}
              </div>
            )}

            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="text-xs text-gray-500">メールアドレス</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="w-32">
                <label className="text-xs text-gray-500">役割</label>
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="member">メンバー</option>
                  <option value="client">クライアント</option>
                </select>
              </div>
              <button
                onClick={handleInvite}
                disabled={!inviteEmail.trim() || inviting}
                className="flex items-center gap-1 px-4 py-2 text-sm text-white bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                {inviting ? '送信中...' : '招待'}
              </button>
            </div>
          </div>
        )}

        {!isOwner && (
          <div className="text-xs text-gray-500 text-center py-2">
            メンバーの管理はオーナーのみ可能です
          </div>
        )}
      </main>
    </div>
  )
}
