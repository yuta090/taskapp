'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle,
  XCircle,
  Warning,
  Spinner,
  ClipboardText,
  CalendarBlank,
  User,
  ChatCircleDots,
  UserGear,
} from '@phosphor-icons/react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { useEntitlements } from '@/lib/hooks/useEntitlements'
import {
  PICKUP_MODE_OPTIONS,
  resolvePickupOptionState,
} from '@/lib/channels/pickupModeOptions'
import type { PickupMode } from '@/lib/channels/store'

interface PendingApprovalItem {
  taskId: string
  title: string
  dueDate: string | null
  dueTime: string | null
  assigneeHint: string | null
  groupId: string
  groupName: string | null
  requestedAt: string | null
  approvalNotifiedAt: string | null
}

interface OrgGroup {
  groupId: string
  displayName: string | null
  spaceId: string
  spaceName: string | null
  approverUserId: string | null
  pickupMode: PickupMode
}

/**
 * グループごとの責任者(approver)設定と取り込みモード(pickup_mode)設定。
 * - 承認フローはこの設定でオプトインする（未設定なら候補は pending にならず従来の申し送り扱い）。
 *   候補は当該 space の admin/editor のみ（承認権限を持つ人）。
 * - 取り込みモードは「毎時まとめ／即時／両方／取り込まない」を選ぶ。両方(all_plus_instant)は
 *   pro 以上限定の有料機能（②）。未解禁 org には選択肢を無効化＋「pro以上」印を出し（事前導線）、
 *   万一 403 が返っても楽観更新をロールバックする（サーバ側 403 と二重防御）。
 */
export function GroupApproverRow({
  orgId,
  group,
  dualModeEntitled,
}: {
  orgId: string
  group: OrgGroup
  dualModeEntitled: boolean
}) {
  const { internalMembers, loading } = useSpaceMembers(group.spaceId)
  const eligible = internalMembers.filter((m) => m.role === 'admin' || m.role === 'editor')
  const [value, setValue] = useState(group.approverUserId ?? '')
  const [saving, setSaving] = useState(false)

  const [pickup, setPickup] = useState<PickupMode>(group.pickupMode)
  const [pickupSaving, setPickupSaving] = useState(false)

  const save = async (next: string) => {
    const prev = value
    setValue(next)
    setSaving(true)
    try {
      const res = await fetch('/api/channels/groups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, groupId: group.groupId, approverUserId: next || null }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? '保存に失敗しました')
      }
      toast.success(next ? '責任者を設定しました' : '承認フローを解除しました')
    } catch (e) {
      setValue(prev) // 楽観更新のロールバック
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const savePickup = async (next: PickupMode) => {
    const prev = pickup
    setPickup(next)
    setPickupSaving(true)
    try {
      const res = await fetch('/api/channels/groups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, groupId: group.groupId, pickupMode: next }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        if (res.status === 403 && json?.error === 'plan_required') {
          setPickup(prev)
          toast.error('「両方」モードは pro 以上のプランで利用できます。')
          return
        }
        throw new Error(json.error ?? '保存に失敗しました')
      }
      toast.success('取り込みモードを変更しました')
    } catch (e) {
      setPickup(prev) // 楽観更新のロールバック
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setPickupSaving(false)
    }
  }

  const label = group.spaceName ?? group.displayName ?? 'グループ'
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{label}</span>
      <div className="flex items-center gap-1.5">
        {pickupSaving && <Spinner className="w-3.5 h-3.5 animate-spin text-gray-400" />}
        <select
          aria-label="取り込みモード"
          value={pickup}
          disabled={pickupSaving}
          onChange={(e) => void savePickup(e.target.value as PickupMode)}
          className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {PICKUP_MODE_OPTIONS.map((opt) => {
            const state = resolvePickupOptionState(opt, {
              entitled: dualModeEntitled,
              current: pickup,
            })
            return (
              <option key={opt.value} value={opt.value} disabled={state.disabled}>
                {opt.label}
                {state.needsUpgrade ? '（pro以上）' : ''}
              </option>
            )
          })}
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        {saving && <Spinner className="w-3.5 h-3.5 animate-spin text-gray-400" />}
        <select
          aria-label="承認フロー責任者"
          value={value}
          disabled={saving || loading}
          onChange={(e) => void save(e.target.value)}
          className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          <option value="">承認フローなし</option>
          {eligible.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** 'YYYY-MM-DD' をローカル日付として安全に整形（toISOStringのUTCずれを避けるため手分解）。 */
function formatDue(dueDate: string | null, dueTime: string | null): string | null {
  if (!dueDate) return null
  const [y, m, d] = dueDate.split('-').map(Number)
  if (!y || !m || !d) return null
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()]
  const base = `${m}/${d}(${wd})`
  if (!dueTime) return base
  const [hh, mm] = dueTime.split(':')
  return `${base} ${hh}:${mm}`
}

/**
 * 「確認待ち」トレイ（Stage 2.7-B §5）— /{orgId}/secretary/approvals
 *
 * セッションユーザー宛の pending 申し送り候補を一覧し、その場で承認/却下する。
 * LINE 1:1 が届かなかった場合の確実なフォールバック（承認/却下はどちらの経路でも同じRPCを通る）。
 * 楽観更新: 成功したら即座にリストから消す（保存ボタンは無い）。
 * タブバー(SecretaryTabNav)は親の secretary/layout.tsx が一元描画するため、
 * ここでは自前で描画しない(二重nav禁止)。
 */
export function ApprovalsClient({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<PendingApprovalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // taskId -> 'approve' | 'reject' の実行中状態
  const [busy, setBusy] = useState<Record<string, 'approve' | 'reject'>>({})
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const [groups, setGroups] = useState<OrgGroup[]>([])
  const { has: hasEntitlement } = useEntitlements(orgId)
  const dualModeEntitled = hasEntitlement('line_pickup_dual_mode')

  const reload = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/channels/digest-tasks/pending?orgId=${orgId}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? '取得に失敗しました')
      setItems(json.items ?? [])
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/channels/groups?orgId=${orgId}`)
        if (!res.ok) return
        const json = await res.json().catch(() => ({}))
        if (!cancelled) setGroups(json.groups ?? [])
      } catch {
        /* 設定セクションはベストエフォート。トレイ本体には影響させない */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  const act = useCallback(
    async (taskId: string, action: 'approve' | 'reject') => {
      setBusy((b) => ({ ...b, [taskId]: action }))
      setRowError((e) => {
        const next = { ...e }
        delete next[taskId]
        return next
      })
      try {
        const res = await fetch('/api/channels/digest-tasks/approval', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, taskId, action }),
        })
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          // 409 は他経路(LINE/別タブ)で既に処理済み。その場合もリストから消して整合させる
          if (res.status === 409) {
            setItems((prev) => prev.filter((it) => it.taskId !== taskId))
            return
          }
          const msg =
            res.status === 403
              ? 'この項目を承認する権限がありません（責任者本人のみ）。'
              : res.status === 404
                ? '対象が見つかりませんでした。'
                : (json.error ?? '処理に失敗しました')
          throw new Error(msg)
        }
        // 楽観更新: 成功したら消す
        setItems((prev) => prev.filter((it) => it.taskId !== taskId))
      } catch (e) {
        setRowError((prev) => ({
          ...prev,
          [taskId]: e instanceof Error ? e.message : '処理に失敗しました',
        }))
      } finally {
        setBusy((b) => {
          const next = { ...b }
          delete next[taskId]
          return next
        })
      }
    },
    [orgId],
  )

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl">
          <section className="mb-4">
            <h2 className="text-sm font-semibold text-gray-900">確認待ち</h2>
            <p className="mt-1 text-xs text-gray-500">
              AI秘書が会話から拾ったタスク候補を、承認するとタスク化・却下するとなかったことになります。
            </p>
          </section>

          {loadError && (
            <div className="mb-4 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <Warning className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{loadError}</span>
              <button
                type="button"
                onClick={() => void reload()}
                className="ml-auto underline hover:no-underline"
              >
                再読み込み
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-gray-400">
              <Spinner className="w-4 h-4 animate-spin" />
              読み込み中...
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <ClipboardText className="w-8 h-8 text-gray-300" />
              <p className="text-sm text-gray-500">確認待ちの候補はありません。</p>
              <p className="max-w-sm text-xs text-gray-400">
                AI秘書が会話から拾ったタスク候補が、承認待ちとしてここに届きます。
                グループに責任者を決めると届きはじめます。
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => {
                const due = formatDue(item.dueDate, item.dueTime)
                const acting = busy[item.taskId]
                const err = rowError[item.taskId]
                return (
                  <li
                    key={item.taskId}
                    className="rounded-lg border border-gray-200 bg-white p-4"
                  >
                    <p className="text-sm font-medium text-gray-900">{item.title}</p>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      {item.groupName && (
                        <span className="inline-flex items-center gap-1">
                          <ChatCircleDots className="w-3.5 h-3.5" />
                          {item.groupName}
                        </span>
                      )}
                      {due && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarBlank className="w-3.5 h-3.5" />
                          {due}
                        </span>
                      )}
                      {item.assigneeHint && (
                        <span className="inline-flex items-center gap-1">
                          <User className="w-3.5 h-3.5" />
                          {item.assigneeHint}
                        </span>
                      )}
                      {item.approvalNotifiedAt === null && (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <Warning className="w-3.5 h-3.5" />
                          LINE未送信
                        </span>
                      )}
                    </div>

                    {err && (
                      <p className="mt-2 rounded bg-red-50 border border-red-200 px-2 py-1.5 text-xs text-red-700">
                        {err}
                      </p>
                    )}

                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={Boolean(acting)}
                        onClick={() => void act(item.taskId, 'approve')}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                      >
                        {acting === 'approve' ? (
                          <Spinner className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CheckCircle weight="bold" className="w-3.5 h-3.5" />
                        )}
                        承認してタスク化
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(acting)}
                        onClick={() => void act(item.taskId, 'reject')}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                      >
                        {acting === 'reject' ? (
                          <Spinner className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <XCircle weight="bold" className="w-3.5 h-3.5" />
                        )}
                        却下
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {groups.length > 0 && (
            <section className="mt-8 border-t border-gray-100 pt-6">
              <div className="mb-2 flex items-center gap-1.5">
                <UserGear className="w-4 h-4 text-gray-400" />
                <h3 className="text-sm font-semibold text-gray-900">承認フロー設定</h3>
              </div>
              <p className="mb-3 text-xs text-gray-500">
                グループごとに<span className="font-medium">取り込みモード</span>（会話をどうタスク化するか）と、
                責任者を決められます。責任者を決めると候補は自動タスク化されず承認待ちになります
                （責任者はそのプロジェクトの管理者・編集者から選べます）。
              </p>
              {!dualModeEntitled && (
                <p className="mb-3 text-xs text-amber-600">
                  「毎時まとめ＋即時（両方）」モードは <span className="font-medium">pro 以上</span> のプランで利用できます。{' '}
                  <Link href="/settings/billing" className="underline hover:text-amber-700">
                    プランを見る
                  </Link>
                </p>
              )}
              <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {groups.map((g) => (
                  <GroupApproverRow
                    key={g.groupId}
                    orgId={orgId}
                    group={g}
                    dualModeEntitled={dualModeEntitled}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
