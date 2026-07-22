'use client'

import { useState, useEffect, useRef } from 'react'
import { Buildings, Check, CircleNotch, Crown, Users, PlugsConnected, CreditCard, CaretRight, Bell } from '@phosphor-icons/react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/hooks/useCurrentOrg'
import { SettingsBackButton } from '@/components/shared'
import type { SupabaseClient } from '@supabase/supabase-js'

export default function OrganizationSettingsPage() {
  const { orgId, orgName, role, loading: orgLoading } = useCurrentOrg()
  const [editName, setEditName] = useState('')
  const [originalName, setOriginalName] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  // 事務所単位の自動期限リマインドオンオフ (org_channel_policy.due_reminders_enabled)。
  // 行が無い/nullはfail-open(true)＝既定有効（サーバ側の coalesce(...,true) と同じ規約・
  // migration 20260721215120）。個人単位の受信オフ(profiles.due_reminder_enabled)は別軸
  // （settings/account側）でそのまま残す。
  const [dueRemindersEnabled, setDueRemindersEnabled] = useState(true)
  const [dueRemindersLoading, setDueRemindersLoading] = useState(true)
  // HIGH-1是正: 取得(select)自体が失敗したとき、既定ON表示のまま操作可能にすると
  // 「実際はOFFのorgに嘘の状態を見せて誤って再度ONにしてしまう」事故になる。
  // 取得失敗時はトグルをdisabledのままにし、エラーを表示する（fail-openはDB上の既定値の話で、
  // クライアントが読めていない状態まで「有効」と偽装してはいけない）。
  const [dueRemindersFetchError, setDueRemindersFetchError] = useState(false)
  // rpc_set_org_due_reminders_enabled 呼び出し失敗時のユーザー可視エラー
  // （旧実装はconsole.warnのみで無言ロールバックしていた・HIGH-1是正）。
  const [dueRemindersSaveError, setDueRemindersSaveError] = useState(false)
  // 低: in-flightガード（page-perf再レビュー是正）。ON→OFF→ONと連打すると、disabled判定に
  // 「保存中」が含まれない場合RPCが同時に2本飛び、(a)到達順逆転でDBとUIが食い違う
  // (b)先行RPCの失敗ロールバックが後発の成功表示を巻き戻す、という事故になる。
  // state(dueRemindersSaving)はUIのdisabled表示用、ref(dueRemindersSavingRef)は
  // クリック連打を同一tick内で確実に弾くための同期ガード（Reactのstate更新は非同期のため、
  // stateだけでは2回目のクリックが1回目の再レンダリング前に素通りしてしまう）。
  const [dueRemindersSaving, setDueRemindersSaving] = useState(false)
  const dueRemindersSavingRef = useRef(false)

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

  useEffect(() => {
    if (!orgId) {
      setDueRemindersLoading(false)
      return
    }

    let cancelled = false
    const fetchDueRemindersPolicy = async () => {
      setDueRemindersLoading(true)
      setDueRemindersFetchError(false)
      try {
        const { data, error } = await (supabase as SupabaseClient)
          .from('org_channel_policy')
          .select('due_reminders_enabled')
          .eq('org_id', orgId)
          .maybeSingle()

        if (error) throw error
        if (!cancelled) {
          const enabled = (data as { due_reminders_enabled?: boolean | null } | null)?.due_reminders_enabled
          setDueRemindersEnabled(enabled ?? true)
        }
      } catch (err) {
        console.error('Failed to fetch due reminders policy:', err)
        // HIGH-1是正: 取得失敗時に既定ON表示のまま操作可能にすると、実際OFFのorgに嘘の状態を
        // 見せてしまう。トグルはdisabledのままにし、エラーを表示する。
        if (!cancelled) setDueRemindersFetchError(true)
      } finally {
        if (!cancelled) setDueRemindersLoading(false)
      }
    }

    void fetchDueRemindersPolicy()
    return () => {
      cancelled = true
    }
  }, [orgId, supabase])

  const handleToggleDueReminders = async () => {
    if (!orgId || !isOwner || dueRemindersFetchError || dueRemindersSavingRef.current) return

    // 同期ガード: awaitに入る前にrefを立てるので、同一tick内の連打（2回目のクリック）は
    // ここで即returnする。
    dueRemindersSavingRef.current = true
    setDueRemindersSaving(true)

    const previous = dueRemindersEnabled
    const next = !previous
    setDueRemindersEnabled(next) // 楽観的更新（保存ボタン無し・プロジェクト規約）
    setDueRemindersSaveError(false)

    try {
      // HIGH-1是正: org_channel_policyへの直接upsertは列レベルGRANT
      // （due_reminders_enabledのみに限定・migration 20260721215120）とON CONFLICT DO UPDATEの
      // 組み合わせでpermission deniedになるため、authz判定込みのRPC経由に変更する
      // （rpc_set_org_due_reminders_enabled・別担当がRPC方式へ用意）。
      const { error } = await (supabase as SupabaseClient).rpc('rpc_set_org_due_reminders_enabled', {
        p_org_id: orgId,
        p_enabled: next,
      })

      if (error) throw error
    } catch (err) {
      console.warn('Failed to persist due reminders policy:', err)
      setDueRemindersEnabled(previous) // 失敗時ロールバック
      setDueRemindersSaveError(true)
    } finally {
      dueRemindersSavingRef.current = false
      setDueRemindersSaving(false)
    }
  }

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
            <SettingsBackButton />
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

        {/* AI秘書: 自動期限リマインドの事務所単位オンオフ */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-900 mb-4 flex items-center gap-2">
            <Bell className="w-4 h-4 text-gray-500" />
            AI秘書の自動期限リマインド
          </h3>
          <div className="flex items-center justify-between">
            <div className="pr-4">
              <p className="text-sm font-medium text-gray-900">自動期限リマインドを使う</p>
              <p className="text-xs text-gray-500 mt-1">
                オフにすると、この事務所全体で自動期限リマインドを停止します（個人ごとの受信オフは各自の設定で。日時を指定した手動リマインドは停止しません）
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                aria-label="自動期限リマインドを使う"
                checked={dueRemindersEnabled}
                onChange={() => void handleToggleDueReminders()}
                disabled={!isOwner || dueRemindersLoading || dueRemindersFetchError || dueRemindersSaving}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600 peer-disabled:opacity-50 peer-disabled:cursor-not-allowed"></div>
            </label>
          </div>
          {!isOwner && <p className="text-xs text-gray-500 mt-3">オーナーのみ変更できます</p>}
          {isOwner && dueRemindersFetchError && (
            <p className="text-xs text-red-600 mt-3">
              設定を読み込めませんでした。時間をおいて再度お試しください。
            </p>
          )}
          {isOwner && dueRemindersSaveError && (
            <p className="text-xs text-red-600 mt-3">保存に失敗しました。もう一度お試しください。</p>
          )}
        </div>

        {/* Organization Management */}
        <div>
          <h2 className="text-sm font-medium text-gray-900 mb-3">組織の管理</h2>
          <div className="space-y-3">
            <Link
              href="/settings/members"
              className="flex items-center justify-between bg-white rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 rounded-lg">
                  <Users className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-900">メンバー管理</h3>
                  <p className="text-xs text-gray-500">メンバー・クライアントの招待と権限管理</p>
                </div>
              </div>
              <CaretRight className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
            </Link>

            <Link
              href="/settings/org-integrations"
              className="flex items-center justify-between bg-white rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 rounded-lg">
                  <PlugsConnected className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-900">組織の外部連携</h3>
                  <p className="text-xs text-gray-500">Slack・GitHub・AI などの組織全体の接続</p>
                </div>
              </div>
              <CaretRight className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
            </Link>

            <Link
              href="/settings/billing"
              className="flex items-center justify-between bg-white rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 rounded-lg">
                  <CreditCard className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-900">プランと請求</h3>
                  <p className="text-xs text-gray-500">プランの確認・変更と請求情報</p>
                </div>
              </div>
              <CaretRight className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
