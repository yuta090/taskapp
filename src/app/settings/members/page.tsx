'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { ArrowLeft, CircleNotch, Users, Crown, Trash, Plus, Warning, MagnifyingGlass, Copy, ArrowClockwise, X } from '@phosphor-icons/react'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/hooks/useCurrentOrg'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { useUserSpaces } from '@/lib/hooks/useUserSpaces'
import type { SupabaseClient } from '@supabase/supabase-js'
import { toast } from 'sonner'

const INVITE_MESSAGE_MAX_LENGTH = 500

function getErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return String(err)
}

interface MemberRow {
  user_id: string
  role: string
  display_name: string
  email: string | null
  avatar_url: string | null
  joined_at: string
}

interface PendingInvite {
  id: string
  email: string
  role: string
  space_id: string
  space_name: string
  created_at: string
  expires_at: string
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

  // Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('')

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviteSpaceId, setInviteSpaceId] = useState('')
  const [inviteNote, setInviteNote] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteMessage, setInviteMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  // Pending invites state
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([])
  const [pendingInviteActionId, setPendingInviteActionId] = useState<string | null>(null)

  const { spaces: userSpaces } = useUserSpaces()
  const invitableSpaces = useMemo(
    () => userSpaces.filter(s => s.orgId === orgId && (s.role === 'admin' || s.role === 'editor')),
    [userSpaces, orgId]
  )

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const isOwner = role === 'owner'

  const isFiltering = searchQuery !== '' || roleFilter !== ''

  const filteredMembers = useMemo(() => {
    let result = members
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        m =>
          m.display_name.toLowerCase().includes(q) ||
          (m.email && m.email.toLowerCase().includes(q))
      )
    }
    if (roleFilter) {
      result = result.filter(m => m.role === roleFilter)
    }
    return result
  }, [members, searchQuery, roleFilter])

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

  const fetchPendingInvites = useCallback(async () => {
    if (!orgId || !isOwner) return

    try {
      const response = await fetch(`/api/invites/pending?org_id=${orgId}`)
      if (!response.ok) throw new Error('Failed to fetch pending invites')
      const data = await response.json()
      setPendingInvites(data.invites || [])
    } catch (err: unknown) {
      console.error('Failed to fetch pending invites:', err)
    }
  }, [orgId, isOwner])

  useEffect(() => {
    if (orgLoading || userLoading) return
    void fetchPendingInvites()
  }, [orgLoading, userLoading, fetchPendingInvites])

  useEffect(() => {
    if (!inviteSpaceId && invitableSpaces.length > 0) {
      setInviteSpaceId(invitableSpaces[0].id)
    }
  }, [invitableSpaces, inviteSpaceId])

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (!isOwner || userId === user?.id || !orgId) return

    const prevMembers = members
    // Optimistic update
    setMembers(prev =>
      prev.map(m => (m.user_id === userId ? { ...m, role: newRole } : m))
    )

    try {
      const { error: updateError } = await (supabase as SupabaseClient)
        .rpc('rpc_update_org_member_role', { p_org_id: orgId, p_user_id: userId, p_role: newRole })

      if (updateError) throw updateError
      toast.success('役割を変更しました')
    } catch (err: unknown) {
      console.error('Failed to update role:', err)
      setMembers(prevMembers) // Rollback
      toast.error(getErrorMessage(err).includes('last owner') ? '最後のオーナーの役割は変更できません' : '役割の変更に失敗しました')
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
        .rpc('rpc_remove_org_member', { p_org_id: orgId, p_user_id: userId })

      if (deleteError) throw deleteError
      toast.success('メンバーを削除しました')
    } catch (err: unknown) {
      console.error('Failed to remove member:', err)
      setMembers(prevMembers) // Rollback
      toast.error(getErrorMessage(err).includes('last owner') ? '最後のオーナーは削除できません' : 'メンバーの削除に失敗しました')
    }
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !isOwner || !orgId || !inviteSpaceId) return
    if (inviteNote.length > INVITE_MESSAGE_MAX_LENGTH) return

    setInviting(true)
    setInviteMessage(null)
    setInviteLink(null)

    try {
      const response = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: orgId,
          space_id: inviteSpaceId,
          email: inviteEmail.trim(),
          role: inviteRole,
          message: inviteNote.trim(),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setInviteMessage({ type: 'error', text: data.error || 'メンバーの招待に失敗しました' })
        return
      }

      if (data.email_sent) {
        setInviteMessage({
          type: 'success',
          text: `${inviteEmail} に招待メールを送信しました`,
        })
      } else {
        const link = `${window.location.origin}${inviteRole === 'client' ? '/portal' : '/invite'}/${data.token}`
        setInviteLink(link)
        setInviteMessage({
          type: 'error',
          text: '招待リンクを作成しました（メール送信に失敗したためリンクを共有してください）',
        })
      }

      setInviteEmail('')
      setInviteNote('')
    } catch (err: unknown) {
      console.error('Failed to invite member:', err)
      setInviteMessage({ type: 'error', text: 'メンバーの招待に失敗しました' })
    } finally {
      setInviting(false)
    }
  }

  const handleCopyInviteLink = async () => {
    if (!inviteLink) return
    try {
      await navigator.clipboard.writeText(inviteLink)
      toast.success('招待リンクをコピーしました')
    } catch (err: unknown) {
      console.error('Failed to copy invite link:', err)
      toast.error('コピーに失敗しました')
    }
  }

  const handleCancelInvite = async (inviteId: string) => {
    if (!isOwner) return
    if (!confirm('この招待を取り消しますか？')) return

    setPendingInviteActionId(inviteId)
    try {
      const response = await fetch(`/api/invites/pending/${inviteId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Failed to cancel invite')

      setPendingInvites(prev => prev.filter(i => i.id !== inviteId))
      toast.success('招待を取り消しました')
    } catch (err: unknown) {
      console.error('Failed to cancel invite:', err)
      toast.error('招待の取り消しに失敗しました')
    } finally {
      setPendingInviteActionId(null)
    }
  }

  const handleResendInvite = async (inviteId: string) => {
    if (!isOwner) return

    setPendingInviteActionId(inviteId)
    try {
      const response = await fetch(`/api/invites/pending/${inviteId}/resend`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to resend invite')

      setPendingInvites(prev =>
        prev.map(i => (i.id === inviteId ? { ...i, expires_at: data.expires_at || i.expires_at } : i))
      )
      toast.success('招待を再送しました')
    } catch (err: unknown) {
      console.error('Failed to resend invite:', err)
      toast.error('招待の再送に失敗しました')
    } finally {
      setPendingInviteActionId(null)
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
                {isFiltering
                  ? `${filteredMembers.length}/${members.length}人`
                  : `${members.length}人`}
              </span>
            </div>
          </div>

          {/* Filter bar */}
          <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2">
            {/* Search input */}
            <div className="relative flex-1">
              <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="名前・メールで検索"
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {/* Role pills */}
            <button
              onClick={() => setRoleFilter('')}
              className={`px-2 py-1 text-[11px] rounded-md border ${
                roleFilter === ''
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              すべて
            </button>
            {ORG_ROLE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setRoleFilter(roleFilter === opt.value ? '' : opt.value)}
                className={`px-2 py-1 text-[11px] rounded-md border ${
                  roleFilter === opt.value
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="divide-y divide-gray-100">
            {members.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500">
                メンバーが見つかりませんでした
              </div>
            ) : filteredMembers.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500">
                条件に一致するメンバーがいません
              </div>
            ) : (
              filteredMembers.map(member => {
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

            {inviteLink && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={inviteLink}
                  className="flex-1 px-3 py-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg"
                />
                <button
                  onClick={handleCopyInviteLink}
                  className="flex items-center gap-1 px-3 py-2 text-xs text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  コピー
                </button>
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
              <div className="w-40">
                <label htmlFor="invite-space" className="text-xs text-gray-500">プロジェクト</label>
                <select
                  id="invite-space"
                  value={inviteSpaceId}
                  onChange={e => setInviteSpaceId(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {invitableSpaces.length === 0 && <option value="">プロジェクトがありません</option>}
                  {invitableSpaces.map(space => (
                    <option key={space.id} value={space.id}>
                      {space.name}
                    </option>
                  ))}
                </select>
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
                disabled={!inviteEmail.trim() || !inviteSpaceId || inviting || inviteNote.length > INVITE_MESSAGE_MAX_LENGTH}
                className="flex items-center gap-1 px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                {inviting ? '送信中...' : '招待'}
              </button>
            </div>

            <div>
              <label htmlFor="invite-message" className="text-xs text-gray-500">メッセージ（任意）</label>
              <textarea
                id="invite-message"
                value={inviteNote}
                onChange={e => setInviteNote(e.target.value)}
                placeholder="招待に添えるひと言メッセージ"
                rows={2}
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
              <div className={`mt-1 text-[11px] text-right ${inviteNote.length > INVITE_MESSAGE_MAX_LENGTH ? 'text-red-600' : 'text-gray-400'}`}>
                {inviteNote.length > INVITE_MESSAGE_MAX_LENGTH && (
                  <span className="float-left text-red-600">{INVITE_MESSAGE_MAX_LENGTH}文字以内で入力してください</span>
                )}
                {inviteNote.length}/{INVITE_MESSAGE_MAX_LENGTH}
              </div>
            </div>
          </div>
        )}

        {/* Pending invites (owner only, hidden when empty) */}
        {isOwner && pendingInvites.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2 text-gray-700">
                <span className="text-sm font-medium">保留中の招待</span>
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                  {pendingInvites.length}件
                </span>
              </div>
            </div>
            <div className="divide-y divide-gray-100">
              {pendingInvites.map(invite => {
                const actionInFlight = pendingInviteActionId === invite.id
                return (
                  <div key={invite.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{invite.email}</div>
                      <div className="text-xs text-gray-500 truncate">
                        {invite.space_name}
                        <span className={`ml-2 px-1.5 py-0.5 rounded ${getRoleBadgeColor(invite.role)}`}>
                          {ORG_ROLE_LABELS[invite.role] || invite.role}
                        </span>
                        <span className="ml-2">
                          期限: {new Date(invite.expires_at).toLocaleDateString('ja-JP')}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleResendInvite(invite.id)}
                      disabled={actionInFlight}
                      className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="招待を再送する"
                    >
                      <ArrowClockwise className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleCancelInvite(invite.id)}
                      disabled={actionInFlight}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="招待を取り消す"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )
              })}
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
