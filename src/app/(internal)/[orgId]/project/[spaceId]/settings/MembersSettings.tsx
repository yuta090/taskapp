'use client'

import { useState, useMemo, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Users, Plus, Trash, Crown, UserCircle, CircleNotch, ArrowClockwise, X } from '@phosphor-icons/react'
import Image from 'next/image'
import type { SupabaseClient } from '@supabase/supabase-js'
import { toast } from 'sonner'
import { useConfirmDialog, Hint } from '@/components/shared'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { useSpaceMemberJoinedAt } from '@/lib/hooks/useSpaceMemberJoinedAt'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import {
  SPACE_ROLE_GUIDE,
  SPACE_ROLE_LABELS,
  INVITE_ROLE_GUIDE,
  INVITE_ROLE_LABELS,
  isSpaceAdminRole,
  canInviteMembers,
} from '@/lib/roles/spaceRoles'
import { InviteTemplateEditor, type InviteTemplateState } from './InviteTemplateEditor'
import { useSpaceInvites } from '@/lib/hooks/useSpaceInvites'
import { INVITE_STATUS_LABEL, type InviteStatus } from '@/lib/invites/status'

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

const ROLE_LABELS = SPACE_ROLE_LABELS

const VALID_ROLES = new Set<string>(SPACE_ROLE_GUIDE.map((r) => r.value))

const INVITE_STATUS_STYLE: Record<InviteStatus, string> = {
  pending: 'bg-amber-50 text-amber-700',
  expired: 'bg-gray-100 text-gray-600',
  accepted: 'bg-green-50 text-green-700',
}

export function MembersSettings({ orgId, spaceId }: MembersSettingsProps) {
  const { confirm, ConfirmDialog } = useConfirmDialog()

  // 一覧の正本は共有キャッシュ（['spaceMembers', spaceId]）ひとつ。以前はこの画面だけ
  // 同じ RPC をもう一度自前で叩いていて、同じ内容を二重に取りに行っていた。
  // 一本化したことで、役割を変えるとこの画面の外（担当者・承認者の選択肢）も同時に変わる。
  const { user } = useCurrentUser()
  const currentUserId = user?.id ?? null
  const {
    members: sharedMembers,
    isPending: membersPending,
    error: membersError,
    refetch: refetchSharedMembers,
    patchMembers,
  } = useSpaceMembers(spaceId)

  const loading = membersPending
  // 在庫があるうちは、背景の取り直しが一瞬こけてもエラー画面に差し替えない。
  // （2分あけてタブに戻ると再取得が走るので、ここを素通しにすると使える一覧が
  //   あるのに画面全体がエラー箱になる）
  const error = sharedMembers.length === 0 ? membersError : null

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviting, setInviting] = useState(false)

  // 文面の下書きは子コンポーネントが持つ（打鍵のたびに一覧まで描き直さないため）。
  // 送るときだけ ref 越しに読み、送ったあとは key を変えて作り直す
  const templateStateRef = useRef<InviteTemplateState>({ fields: null, saveAsTemplate: false, refresh: () => {} })
  const [templateResetSeq, setTemplateResetSeq] = useState(0)
  const [templateOpen, setTemplateOpen] = useState(false)

  // メンバー / 返事待ち / 招待の履歴 の切り替え
  const [activeTab, setActiveTab] = useState<'members' | 'pending' | 'history'>('members')
  const [invitesActionId, setInvitesActionId] = useState<string | null>(null)

  // 参加日は一覧 RPC に含まれないのでここだけ別に取る（一覧とは独立・同時に走る）。
  // 表示するのはメンバーのタブだけなので、招待のタブでは取りに行かない
  const joinedAtByUser = useSpaceMemberJoinedAt(spaceId, activeTab === 'members')

  const members: Member[] = useMemo(
    () =>
      sharedMembers.map((m) => ({
        userId: m.id,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl,
        role: m.role,
        joinedAt: joinedAtByUser?.[m.id] ?? '',
      })),
    [sharedMembers, joinedAtByUser]
  )

  const supabase = useMemo(() => createClient(), [])

  const roleKey: 'client' | 'member' = inviteRole === 'client' ? 'client' : 'member'

  const {
    invites,
    canManage: canManageInvites,
    loading: invitesLoading,
    refresh: refreshInvites,
  } = useSpaceInvites(spaceId, activeTab === 'history' ? 'all' : 'pending', activeTab !== 'members')

  // 「もう一度送る」が実際に出ている行があるときだけ案内を出す
  // （履歴タブが参加済みだけのときに、押せないボタンの話をしないため）
  const hasResendableInvite = canManageInvites && invites.some((i) => i.status !== 'accepted')

  const myRole = useMemo(
    () => sharedMembers.find((m) => m.id === currentUserId)?.role,
    [sharedMembers, currentUserId]
  )

  // 招待は編集者にも開放する（サーバー側の /api/invites・rpc_create_invite も admin/editor を許可済み）。
  // 役割の変更とメンバー削除は引き続き管理者だけ。
  const isAdmin = isSpaceAdminRole(myRole)
  const canInvite = canInviteMembers(myRole)

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (!isAdmin || userId === currentUserId) return

    // Validate role on client side (DB should also have constraint)
    if (!VALID_ROLES.has(newRole)) {
      console.error('Invalid role:', newRole)
      toast.error('無効な役割です')
      return
    }

    // 共有キャッシュを先に書き換える（この画面の外の選択肢も同時に変わる）
    const rollback = patchMembers((prev) =>
      prev.map((m) => (m.id === userId ? { ...m, role: newRole } : m))
    )

    try {
      const { error } = await (supabase as SupabaseClient)
        .rpc('rpc_update_space_member_role', { p_space_id: spaceId, p_user_id: userId, p_role: newRole })

      if (error) throw error
      toast.success('役割を変更しました')
      // サーバーの結果で上書きし直す（役割の変換など、こちらの想定と違ってもズレない）
      void refetchSharedMembers()
    } catch (err) {
      console.error('Failed to update role:', err)
      rollback()
      toast.error('役割の変更に失敗しました')
    }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!isAdmin || userId === currentUserId) return
    const ok = await confirm({
      title: 'メンバーを削除',
      message: 'このメンバーをプロジェクトから削除しますか？',
      confirmLabel: '削除',
      variant: 'danger',
    })
    if (!ok) return

    const rollback = patchMembers((prev) => prev.filter((m) => m.id !== userId))

    try {
      const { error } = await (supabase as SupabaseClient)
        .rpc('rpc_remove_space_member', { p_space_id: spaceId, p_user_id: userId })

      if (error) throw error
      toast.success('メンバーを削除しました')
      void refetchSharedMembers()
    } catch (err) {
      console.error('Failed to remove member:', err)
      rollback()
      toast.error('メンバーの削除に失敗しました')
    }
  }

  const handleResendInvite = useCallback(
    async (inviteId: string) => {
      setInvitesActionId(inviteId)
      try {
        const res = await fetch(`/api/invites/pending/${inviteId}/resend`, { method: 'POST' })
        if (!res.ok) throw new Error('resend failed')
        toast.success('招待メールをもう一度送りました（期限も延びました）')
        refreshInvites()
      } catch {
        toast.error('招待メールを送り直せませんでした')
      } finally {
        setInvitesActionId(null)
      }
    },
    [refreshInvites]
  )

  const handleCancelInvite = useCallback(
    async (inviteId: string) => {
      const ok = await confirm({
        title: '招待を取り消す',
        message: 'この招待を取り消しますか？相手のリンクは使えなくなります。',
        confirmLabel: '取り消す',
        variant: 'danger',
      })
      if (!ok) return
      setInvitesActionId(inviteId)
      try {
        const res = await fetch(`/api/invites/pending/${inviteId}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('cancel failed')
        toast.success('招待を取り消しました')
        refreshInvites()
      } catch {
        toast.error('招待を取り消せませんでした')
      } finally {
        setInvitesActionId(null)
      }
    },
    [confirm, refreshInvites]
  )

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !canInvite || inviting) return

    setInviting(true)

    try {
      // 文面は子コンポーネントが持っている。触っていなければ null（いつもの文面で送る）
      const { fields: templateFields, saveAsTemplate, refresh: refreshTemplate } = templateStateRef.current

      const response = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: orgId,
          space_id: spaceId,
          email: inviteEmail.trim(),
          role: inviteRole,
          ...(inviteName.trim() ? { name: inviteName.trim() } : {}),
          ...(templateFields ? { template: templateFields } : {}),
          ...(saveAsTemplate ? { save_as_template: true } : {}),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        toast.error(data.error || 'メンバーの招待に失敗しました')
        return
      }

      toast.success(
        data.email_sent
          ? `${inviteEmail.trim()} に招待メールを送信しました`
          : '招待を作成しました（メール送信に失敗したため招待リンクを直接共有してください）'
      )
      if (data.template_saved === false) {
        toast.error('メールは送りましたが、テンプレートとして保存できませんでした')
      }
      if (saveAsTemplate) refreshTemplate()
      // その場の編集は1通かぎり。作り直して次の人に持ち越さない
      setTemplateResetSeq((n) => n + 1)
      setInviteName('')
      refreshInvites()
      // すでに登録済みの相手を招待した場合はその場で参加者になる。一覧に出るよう取り直す
      void refetchSharedMembers()
      setInviteEmail('')
    } catch (err) {
      console.error('Failed to invite member:', err)
      toast.error('メンバーの招待に失敗しました')
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
      {ConfirmDialog}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-700">
          <Users className="text-lg" />
          <h3 className="font-medium">メンバー</h3>
          <Hint label="役割ごとにできること">
            <span className="mb-1 block font-medium text-gray-700">役割ごとにできること</span>
            {SPACE_ROLE_GUIDE.map((role) => (
              <span key={role.value} className="mt-1.5 block first:mt-0">
                <span className="font-medium text-gray-700">{role.label}</span>
                <span className="block">{role.desc}</span>
              </span>
            ))}
          </Hint>
        </div>
      </div>

      {/* 「いま居る人」と「返事待ち」と「これまでの招待」を切り替える */}
      <div className="flex items-center gap-1 border-b border-gray-200" role="tablist">
        {([
          { id: 'members' as const, label: 'メンバー', count: members.length },
          { id: 'pending' as const, label: '返事待ち', count: null },
          { id: 'history' as const, label: '招待の履歴', count: null },
        ]).map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? 'border-indigo-600 text-gray-900 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            {tab.count !== null && <span className="ml-1.5 text-xs text-gray-500">{tab.count}</span>}
          </button>
        ))}
      </div>

      {/* Members list */}
      {activeTab === 'members' && (
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
                    <span className="text-xs text-indigo-ink bg-indigo-50 px-1.5 py-0.5 rounded">
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
                  {SPACE_ROLE_GUIDE.map((opt) => (
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
                      ? 'bg-amber-50 text-amber-700'
                      : member.role === 'vendor'
                      ? 'bg-indigo-50 text-indigo-ink'
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
      )}

      {activeTab !== 'members' && (
        <>
          {hasResendableInvite && (
            <p className="text-xs text-gray-500">
              相手にメールが届いていないときは、その人の行にある「もう一度送る」を押してください。招待メールをもう一度送り直せます。
            </p>
          )}
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
            {invitesLoading ? (
              <div className="flex items-center justify-center py-8">
                <CircleNotch className="w-5 h-5 text-gray-400 animate-spin" />
              </div>
            ) : invites.length === 0 ? (
              <div className="px-4 py-6 text-sm text-gray-500 text-center">
                {activeTab === 'pending' ? '返事待ちの招待はありません' : 'まだ招待していません'}
              </div>
            ) : (
              invites.map((invite) => (
                <div
                  key={invite.id}
                  data-testid="invite-row"
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-gray-50"
                >
                  <div className="flex-1 min-w-0 basis-48">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {invite.invitee_name || invite.email}
                      </span>
                      <span className="text-xs text-gray-500 flex-shrink-0">
                        {INVITE_ROLE_LABELS[invite.role] || invite.role}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {invite.invitee_name ? `${invite.email}・` : ''}
                      {`送信: ${new Date(invite.created_at).toLocaleDateString('ja-JP')}`}
                      {invite.status === 'accepted' && invite.accepted_at
                        ? `・参加: ${new Date(invite.accepted_at).toLocaleDateString('ja-JP')}`
                        : `・期限: ${new Date(invite.expires_at).toLocaleDateString('ja-JP')}`}
                    </div>
                  </div>

                  <span className={`px-2 py-1 text-xs rounded flex-shrink-0 ${INVITE_STATUS_STYLE[invite.status]}`}>
                    {INVITE_STATUS_LABEL[invite.status]}
                  </span>

                  {canManageInvites && invite.status !== 'accepted' && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleResendInvite(invite.id)}
                        disabled={invitesActionId === invite.id}
                        title={
                          invite.status === 'expired'
                            ? '招待メールをもう一度送ります（期限も延びます）'
                            : '招待メールをもう一度送ります'
                        }
                        className="flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-ink transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ArrowClockwise className="w-3.5 h-3.5 flex-shrink-0" />
                        もう一度送る
                      </button>
                      <button
                        onClick={() => handleCancelInvite(invite.id)}
                        disabled={invitesActionId === invite.id}
                        title="この招待のリンクを使えなくします"
                        className="flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <X className="w-3.5 h-3.5 flex-shrink-0" />
                        招待を取り消す
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* Invite form (管理者・編集者) */}
      {canInvite && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="text-xs font-medium text-gray-500">メンバーを招待</div>

          <div className="flex items-end gap-3">
            <div className="w-40">
              <label htmlFor="space-invite-name" className="text-xs text-gray-500">名前（任意）</label>
              <input
                id="space-invite-name"
                type="text"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="山田 太郎"
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="space-invite-email" className="text-xs text-gray-500">メールアドレス</label>
              <input
                id="space-invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="email@example.com"
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="w-40">
              <label htmlFor="space-invite-role" className="text-xs text-gray-500">役割</label>
              <Hint label="招待する役割" align="right">
                {INVITE_ROLE_GUIDE.map((role) => (
                  <span key={role.value} className="mt-1.5 block first:mt-0">
                    <span className="font-medium text-gray-700">{role.label}</span>
                    <span className="block">{role.desc}</span>
                  </span>
                ))}
                <span className="mt-2 block border-t border-gray-100 pt-1.5 text-gray-500">
                  参加したあとの役割（管理者・編集者・閲覧者）は、上のメンバー一覧から管理者が変えられます。
                </span>
              </Hint>
              <select
                id="space-invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {INVITE_ROLE_GUIDE.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleInvite}
              disabled={!inviteEmail.trim() || inviting}
              className="flex items-center gap-1 px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              {inviting ? '送信中...' : '招待'}
            </button>
          </div>

          <InviteTemplateEditor
            key={`invite-template-${templateResetSeq}`}
            spaceId={spaceId}
            role={roleKey}
            stateRef={templateStateRef}
            confirm={confirm}
            open={templateOpen}
            onToggle={() => setTemplateOpen((v) => !v)}
          />
        </div>
      )}

      {!canInvite && (
        <div className="text-xs text-gray-500 text-center py-2">
          <UserCircle className="inline w-4 h-4 mr-1" />
          メンバーの管理は管理者のみ可能です
        </div>
      )}

      {canInvite && !isAdmin && (
        <div className="text-xs text-gray-500 text-center py-2">
          <UserCircle className="inline w-4 h-4 mr-1" />
          役割の変更とメンバーの削除は管理者のみ可能です
        </div>
      )}
    </div>
  )
}
