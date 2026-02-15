'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Users, Plus, Trash, Crown, UserCircle, CircleNotch, Warning } from '@phosphor-icons/react'
import Image from 'next/image'
import type { SupabaseClient } from '@supabase/supabase-js'

interface Member {
  userId: string
  displayName: string
  avatarUrl: string | null
  role: string
  joinedAt: string
}

interface MembersSettingsProps {
  orgId: string
  spaceId: string
}

const ROLE_LABELS: Record<string, string> = {
  admin: '管理者',
  editor: '編集者',
  viewer: '閲覧者',
  client: 'クライアント',
}

const ROLE_OPTIONS = [
  { value: 'admin', label: '管理者' },
  { value: 'editor', label: '編集者' },
  { value: 'viewer', label: '閲覧者' },
  { value: 'client', label: 'クライアント' },
]

const VALID_ROLES = new Set(['admin', 'editor', 'viewer', 'client'])

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function MembersSettings({ orgId, spaceId }: MembersSettingsProps) {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('editor')
  const [inviting, setInviting] = useState(false)
  const [inviteMessage, setInviteMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const supabase = useMemo(() => createClient(), [])

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) {
        setMembers([])
        setCurrentUserId(null)
        setError('ログインが必要です')
        return
      }
      setCurrentUserId(user.id)

      // Use RPC to get members with profiles
      const { data, error: fetchError } = await (supabase as SupabaseClient)
        .rpc('rpc_get_space_members', { p_space_id: spaceId })

      if (fetchError) throw fetchError

      // Get membership dates (separate query for join dates)
      // Note: If this fails due to RLS, we still show members without dates
      const { data: membershipData, error: membershipError } = await (supabase as SupabaseClient)
        .from('space_memberships')
        .select('user_id, role, created_at')
        .eq('space_id', spaceId)

      if (membershipError) {
        console.warn('Could not fetch membership details:', membershipError)
      }

      const membershipMap = new Map<string, { user_id: string; role: string; created_at: string }>(
        (membershipData || []).map((m: { user_id: string; role: string; created_at: string }) => [m.user_id, m] as const)
      )

      const memberList: Member[] = (data || []).map((m: { user_id: string; display_name: string | null; avatar_url: string | null; role: string }) => {
        const membership = membershipMap.get(m.user_id)
        return {
          userId: m.user_id,
          displayName: m.display_name || m.user_id.slice(0, 8) + '...',
          avatarUrl: m.avatar_url,
          role: m.role,
          joinedAt: membership?.created_at || '',
        }
      })

      // Check if current user is admin
      const currentMember = memberList.find((m) => m.userId === user?.id)
      setIsAdmin(currentMember?.role === 'admin')

      setMembers(memberList)
    } catch (err) {
      console.error('Failed to fetch members:', err)
      setError('メンバー情報の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [spaceId, supabase])

  useEffect(() => {
    void fetchMembers()
  }, [fetchMembers])

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (!isAdmin || userId === currentUserId) return

    // Validate role on client side (DB should also have constraint)
    if (!VALID_ROLES.has(newRole)) {
      console.error('Invalid role:', newRole)
      alert('無効な役割です')
      return
    }

    try {
      // Note: Security relies on RLS policy on space_memberships table
      // TODO: Consider moving to RPC with explicit admin check for defense in depth
      const { error } = await (supabase as SupabaseClient)
        .from('space_memberships')
        .update({ role: newRole })
        .eq('space_id', spaceId)
        .eq('user_id', userId)

      if (error) throw error

      // Update local state
      setMembers((prev) =>
        prev.map((m) => (m.userId === userId ? { ...m, role: newRole } : m))
      )
    } catch (err) {
      console.error('Failed to update role:', err)
      alert('役割の変更に失敗しました')
    }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!isAdmin || userId === currentUserId) return
    if (!confirm('このメンバーをプロジェクトから削除しますか？')) return

    try {
      const { error } = await (supabase as SupabaseClient)
        .from('space_memberships')
        .delete()
        .eq('space_id', spaceId)
        .eq('user_id', userId)

      if (error) throw error

      // Update local state
      setMembers((prev) => prev.filter((m) => m.userId !== userId))
    } catch (err) {
      console.error('Failed to remove member:', err)
      alert('メンバーの削除に失敗しました')
    }
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !isAdmin) return

    setInviting(true)
    setInviteMessage(null)

    try {
      // Check if user exists by email
      // Note: This would typically be done through an API endpoint for security
      // For now, we'll show a message about the invite flow
      setInviteMessage({
        type: 'success',
        text: `${inviteEmail} への招待メール送信機能は準備中です。直接メンバーを追加する場合は、まずユーザーにアカウント作成を依頼してください。`,
      })
      setInviteEmail('')
    } catch (err) {
      console.error('Failed to invite member:', err)
      setInviteMessage({ type: 'error', text: 'メンバーの招待に失敗しました' })
    } finally {
      setInviting(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-gray-700">
          <Users className="text-lg" />
          <h3 className="font-medium">メンバー</h3>
        </div>
        <div className="flex items-center justify-center py-8">
          <CircleNotch className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-gray-700">
          <Users className="text-lg" />
          <h3 className="font-medium">メンバー</h3>
        </div>
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-700">
          <Users className="text-lg" />
          <h3 className="font-medium">メンバー</h3>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
            {members.length}人
          </span>
        </div>
      </div>

      {/* Members list */}
      <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
        {members.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-500 text-center">
            メンバーはまだいません
          </div>
        ) : (
          members.map((member) => (
            <div
              key={member.userId}
              className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50"
            >
              {/* Avatar */}
              {member.avatarUrl ? (
                <Image
                  src={member.avatarUrl}
                  alt=""
                  width={32}
                  height={32}
                  className="w-8 h-8 rounded-full object-cover"
                  unoptimized
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-xs font-medium">
                  {member.displayName.charAt(0).toUpperCase()}
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 truncate">
                    {member.displayName}
                  </span>
                  {member.userId === currentUserId && (
                    <span className="text-xs text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                      あなた
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  {member.joinedAt
                    ? `参加: ${new Date(member.joinedAt).toLocaleDateString('ja-JP')}`
                    : ''}
                </div>
              </div>

              {/* Role */}
              {isAdmin && member.userId !== currentUserId ? (
                <select
                  value={member.role}
                  onChange={(e) => handleRoleChange(member.userId, e.target.value)}
                  className="px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span
                  className={`px-2 py-1 text-xs rounded ${
                    member.role === 'admin'
                      ? 'bg-amber-100 text-amber-700'
                      : member.role === 'client'
                      ? 'bg-amber-50 text-amber-600'
                      : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {member.role === 'admin' && <Crown className="inline w-3 h-3 mr-1" weight="fill" />}
                  {ROLE_LABELS[member.role] || member.role}
                </span>
              )}

              {/* Delete button */}
              {isAdmin && member.userId !== currentUserId && (
                <button
                  onClick={() => handleRemoveMember(member.userId)}
                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                  title="メンバーを削除"
                >
                  <Trash className="w-4 h-4" />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Invite form (admin only) */}
      {isAdmin && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
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
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="email@example.com"
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="w-32">
              <label className="text-xs text-gray-500">役割</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
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

      {!isAdmin && (
        <div className="text-xs text-gray-500 text-center py-2">
          <UserCircle className="inline w-4 h-4 mr-1" />
          メンバーの管理は管理者のみ可能です
        </div>
      )}
    </div>
  )
}
