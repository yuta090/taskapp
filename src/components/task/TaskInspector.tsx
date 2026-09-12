'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import NextLink from 'next/link'
import { X, ArrowRight, Circle, User, Calendar, Link as LinkIcon, Trash, PencilSimple, Check, Flag, Timer, TreeStructure, ChatCircleText, CaretDown, CaretRight, FileText, CopySimple, CurrencyJpy, Eye, BookOpen, PushPin } from '@phosphor-icons/react'
import { TaskReminderField } from './TaskReminderField'
import { AmberBadge, Hint, LinkifiedText, Tooltip, TruncatedText, useConfirmDialog } from '@/components/shared'
import { createClient } from '@/lib/supabase/client'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { useSpacePendingInvites, pendingInviteLabel } from '@/lib/hooks/useSpacePendingInvites'
import { useWikiPages } from '@/lib/hooks/useWikiPages'
import { useSpaceSettings } from '@/lib/hooks/useSpaceSettings'
import { useAgencyMode } from '@/lib/hooks/useAgencyMode'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { useLatestClientAction } from '@/lib/hooks/useLatestClientAction'
import { WARNING, CLIENT } from '@/lib/design/tokens'
import { toast } from 'sonner'
import { TaskComments } from './TaskComments'
import { TaskEventTimeline } from './TaskEventTimeline'
import { ConsideringDecisionPanel } from './ConsideringDecisionPanel'
import { TaskPRList, TaskIssueList } from '@/components/github'
import { SlackPostButton } from '@/components/slack'
import { TaskReviewSection } from '@/components/review'
import { TaskPricingPanel } from './TaskPricingPanel'
import { WikiPageLinkPicker } from './WikiPageLinkPicker'
import { isPageInMilestone, pickMilestoneWikiPages } from '@/lib/wiki/listView'
import { useWikiMilestoneLinks } from '@/lib/hooks/useWikiMilestoneLinks'
import type { Task, TaskOwner, TaskStatus, Milestone, DecisionState, ClientScope, WikiPage } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatTaskNumber } from '@/lib/tasks/taskNumber'
import { SPACE_ROLE_LABELS } from '@/lib/roles/spaceRoles'

interface TaskInspectorProps {
  task: Task
  spaceId: string
  owners?: TaskOwner[]
  onClose: () => void
  onPassBall?: (ball: 'client' | 'internal', clientOwnerIds?: string[], internalOwnerIds?: string[]) => void | Promise<void>
  onUpdate?: (updates: {
    title?: string
    description?: string | null
    status?: TaskStatus
    startDate?: string | null
    dueDate?: string | null
    milestoneId?: string | null
    assigneeId?: string | null
    assigneeInviteId?: string | null
    parentTaskId?: string | null
    actualHours?: number | null
    wikiPageId?: string | null
    /** 紐づけるページが仕様書か。false ならリンクだけ保存し、仕様タスク(検討中)にしない */
    wikiPageIsSpec?: boolean
    estimatedCost?: number | null
    estimateStatus?: 'none' | 'pending' | 'approved' | 'rejected'
    clientScope?: ClientScope
  }) => Promise<void>
  onDelete?: () => Promise<void>
  onDuplicate?: () => void
  onUpdateOwners?: (clientOwnerIds: string[], internalOwnerIds: string[]) => Promise<void>
  /** AT-009: Spec task state transition */
  onSetSpecState?: (decisionState: DecisionState) => Promise<void>
  /** AT-007: refetch after an out-of-meeting client decision is recorded */
  onConsideringDecided?: () => void
  onReviewChange?: (taskId: string, status: string | null) => void
  /** Available parent tasks for parent selection */
  parentTasks?: { id: string; title: string }[]
  /** Child tasks of this task */
  childTasks?: Task[]
  /**
   * 代理店モードの価格の枠（TaskPricingPanel）を出してよいか。
   * DB側の書き込み判定（guard_task_pricing_write/delete, 20260308_003）と同じ規則:
   * その space の space_memberships の行がはっきり admin/editor の人だけ
   * （行が無い社内メンバーも含めて、それ以外は false）。呼び出し元が
   * canEditSpaceMoney（spaceRoles.ts）で判定して渡す。既定は false（安全側）。
   */
  canEditPricing?: boolean
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: '未着手' },
  { value: 'todo', label: '着手予定' },
  { value: 'in_progress', label: '進行中' },
  { value: 'in_review', label: '社内承認中' },
  { value: 'done', label: '完了' },
  { value: 'considering', label: '検討中' },
]

export function TaskInspector({
  task,
  spaceId,
  owners = [],
  onClose,
  onPassBall,
  onUpdate,
  onDelete,
  onDuplicate,
  onUpdateOwners,
  onSetSpecState,
  onConsideringDecided,
  onReviewChange,
  parentTasks = [],
  childTasks = [],
  canEditPricing = false,
}: TaskInspectorProps) {
  const { confirm, ConfirmDialog } = useConfirmDialog()
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState(task.title)
  const [isEditingDescription, setIsEditingDescription] = useState(false)
  const [editDescription, setEditDescription] = useState(task.description || '')
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSavingOwners, setIsSavingOwners] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [estimateInput, setEstimateInput] = useState('')
  const [isSendingEstimate, setIsSendingEstimate] = useState(false)
  const [taskNumberCopied, setTaskNumberCopied] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const taskNumberCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // AT-009: Spec task 2-click workflow state
  const [specConfirmClickTime, setSpecConfirmClickTime] = useState<number | null>(null)
  const [specConfirmTaskId, setSpecConfirmTaskId] = useState<string | null>(null)
  const [isSettingSpecState, setIsSettingSpecState] = useState(false)

  // Reset spec confirmation state and pending ball change when task changes
  useEffect(() => {
    setSpecConfirmClickTime(null)
    setSpecConfirmTaskId(null)
    setIsSettingSpecState(false)
    setPendingBallChange(null)
    setOwnerValidationError(null)
    setEditingOwners(false)
    setEstimateInput(task.estimated_cost != null ? String(task.estimated_cost) : '')
    setIsSendingEstimate(false)
    // タスク切り替え時は前のタスクの「コピーしました」タイマーを引き継がない（Inspector は
    // タスクを切り替えてもアンマウントされないため、放置すると別タスクの番号欄に一瞬出る）
    if (taskNumberCopiedTimerRef.current) clearTimeout(taskNumberCopiedTimerRef.current)
    setTaskNumberCopied(false)
    // Progressive disclosure: 詳細設定に値があれば展開
    const hasDetails = !!(
      task.parent_task_id ||
      childTasks.length > 0 ||
      owners.length > 0 ||
      task.type === 'spec'
    )
    setShowDetails(hasDetails)
  }, [task.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Milestone data
  const [milestones, setMilestones] = useState<Milestone[]>([])

  // Wiki pages for spec link（候補はタグの有無に関係なく全ページ。資料が増えても名前で探せるように）
  // 空のWikiの自動作成は編集できる人（onUpdate が渡されている）のときだけ行う
  const {
    pages: wikiPages,
    createPage,
    loading: wikiPagesLoading,
    error: wikiPagesError,
  } = useWikiPages({ orgId: task.org_id, spaceId, canEdit: !!onUpdate })
  // PR3: タスク詳細から同じマイルストーンの Wiki を引ける導線（補助情報。詳細設定の件数バッジには含めない）
  // PR4: 所属マイルストーン = page.milestone_id ∪ タスク参照（同じ queryKey で一覧側とキャッシュ共有）
  // マイルストーン未設定のタスクではこの情報を一切使わないので取りに行かない
  const { linksByPageId: wikiMilestoneLinks } = useWikiMilestoneLinks(task.org_id, spaceId, {
    enabled: !!task.milestone_id,
  })
  const milestoneWikiPages = useMemo(
    () => pickMilestoneWikiPages(wikiPages, task.milestone_id, 5, wikiMilestoneLinks),
    [wikiPages, task.milestone_id, wikiMilestoneLinks]
  )
  const milestoneWikiTotalCount = useMemo(() => {
    const milestoneId = task.milestone_id
    if (!milestoneId) return 0
    // pickMilestoneWikiPages と同じ判定を使う（条件を二重に書くと件数だけずれる）
    return wikiPages.filter((p) => isPageInMilestone(p, milestoneId, wikiMilestoneLinks)).length
  }, [wikiPages, task.milestone_id, wikiMilestoneLinks])

  // Space members with display names
  const { members, clientMembers, internalMembers, getMemberName, loading: membersLoading } = useSpaceMembers(spaceId)
  // 招待中（まだ承諾していない）の人も担当者に選べる。承諾するとDB側で本人へ自動で移る
  const { pendingInvites } = useSpacePendingInvites(spaceId)

  // H-1: derived (no new column) — surfaces "client requested changes" when the ball is back internally
  const latestClientAction = useLatestClientAction(task.id)
  const showChangesRequestedBadge = task.ball === 'internal' && latestClientAction === 'changes_requested'

  // FR-OWN-002: 責任者欄の表示/非表示設定
  const { shouldShowOwnerField } = useSpaceSettings(spaceId)

  // Agency mode: pricing panel
  const { data: agencyData } = useAgencyMode(spaceId)

  // Current user for comments
  const { user } = useCurrentUser()
  const currentUserId = user?.id || null
  const isInternalMember = currentUserId ? internalMembers.some(m => m.id === currentUserId) : false

  // Owner editing state
  const [editingOwners, setEditingOwners] = useState(false)
  const [selectedClientOwners, setSelectedClientOwners] = useState<string[]>([])
  const [selectedInternalOwners, setSelectedInternalOwners] = useState<string[]>([])

  // Pending ball change state: when user clicks "外部" but no client owners exist yet
  const [pendingBallChange, setPendingBallChange] = useState<'client' | null>(null)
  const [ownerValidationError, setOwnerValidationError] = useState<string | null>(null)

  // Ref for auto-scroll to inline owner selector
  const pendingOwnerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to inline owner selector when pending state activates
  useEffect(() => {
    if (pendingBallChange && pendingOwnerRef.current) {
      pendingOwnerRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [pendingBallChange])

  const supabase = useMemo(() => createClient(), [])

  const clientOwners = owners.filter((o) => o.side === 'client')
  const internalOwners = owners.filter((o) => o.side === 'internal')

  // 詳細設定セクションの設定済み件数
  const detailCount = useMemo(() => {
    let count = 0
    if (task.parent_task_id) count++
    if (childTasks.length > 0) count++
    if (owners.length > 0) count++
    return count
  }, [task.parent_task_id, childTasks.length, owners.length])

  // Fetch milestones
  useEffect(() => {
    const fetchMilestones = async () => {
       
      const { data: msData } = await (supabase as SupabaseClient)
        .from('milestones')
        .select('*')
        .eq('space_id' as never, spaceId as never)
        .order('order_key' as never, { ascending: true })

      if (msData) setMilestones(msData)
    }

    void fetchMilestones()
  }, [spaceId, supabase])

  // Initialize owner selection when editing starts
  const handleStartEditingOwners = () => {
    setSelectedClientOwners(clientOwners.map((o) => o.user_id))
    setSelectedInternalOwners(internalOwners.map((o) => o.user_id))
    setEditingOwners(true)
  }

  // Show brief "saved" indicator
  const flashSaved = () => {
    setShowSaved(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setShowSaved(false), 2000)
  }

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      if (taskNumberCopiedTimerRef.current) clearTimeout(taskNumberCopiedTimerRef.current)
    }
  }, [])

  const taskNumber = formatTaskNumber(task.short_id)

  const handleCopyTaskNumber = async () => {
    if (!taskNumber) return
    try {
      await navigator.clipboard.writeText(taskNumber)
      setTaskNumberCopied(true)
      if (taskNumberCopiedTimerRef.current) clearTimeout(taskNumberCopiedTimerRef.current)
      taskNumberCopiedTimerRef.current = setTimeout(() => setTaskNumberCopied(false), 1500)
    } catch {
      // コピー失敗はユーザー操作の妨げにならないよう無視する
    }
  }

  const handleTitleSave = async () => {
    if (!editTitle.trim() || editTitle === task.title) {
      setEditTitle(task.title)
      setIsEditingTitle(false)
      return
    }
    await onUpdate?.({ title: editTitle.trim() })
    setIsEditingTitle(false)
    flashSaved()
  }

  // 説明欄の高さを測り直すときにスクロール位置を戻すため、スクロール容器を掴んでおく。
  const contentScrollRef = useRef<HTMLDivElement>(null)

  // 説明欄は中身の量に合わせて高さを伸ばす（上限は className の max-h、超えたら中でスクロール）。
  // 保存して編集を閉じれば従来どおりの本文表示に戻るので、伸びるのは編集中だけ。
  // useCallback で identity を固定する（毎描画で ref を貼り直すと打鍵ごとに2回測ることになる）。
  const lastAutoHeightRef = useRef<string | null>(null)
  const manualHeightRef = useRef(false)
  const autoGrowDescription = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) {
      // 編集を閉じたら次回のためにリセット
      lastAutoHeightRef.current = null
      manualHeightRef.current = false
      return
    }
    // 自分が付けた高さと違う＝ユーザーが右下をドラッグして決めた高さ。以降は尊重して触らない。
    if (lastAutoHeightRef.current !== null && el.style.height !== lastAutoHeightRef.current) {
      manualHeightRef.current = true
    }
    if (manualHeightRef.current) return

    // 一度 auto に戻して測るとパネルの中身が一瞬縮み、スクロール位置がブラウザに
    // 切り詰められて打鍵ごとに画面が跳ねる。測る前後で scrollTop を戻して防ぐ。
    // （jsdom はレイアウトを持たず切り詰めが起きないため、この復元は単体テストでは検証できない）
    const scroller = contentScrollRef.current
    const scrollTop = scroller?.scrollTop
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    lastAutoHeightRef.current = el.style.height
    if (scroller && scrollTop !== undefined) scroller.scrollTop = scrollTop
  }, [])

  const handleDescriptionSave = async () => {
    const newDesc = editDescription.trim() || null
    if (newDesc === (task.description || null)) {
      setIsEditingDescription(false)
      return
    }
    await onUpdate?.({ description: newDesc })
    setIsEditingDescription(false)
    flashSaved()
  }

  const handleStatusChange = async (status: TaskStatus) => {
    if (status !== task.status) {
      await onUpdate?.({ status })
      flashSaved()
    }
  }

  const handleStartDateChange = async (dateStr: string) => {
    const startDate = dateStr || null
    if (startDate !== task.start_date) {
      await onUpdate?.({ startDate })
      flashSaved()
    }
  }

  const handleDueDateChange = async (dateStr: string) => {
    const dueDate = dateStr || null
    if (dueDate !== task.due_date) {
      await onUpdate?.({ dueDate })
      flashSaved()
    }
  }

  const handleActualHoursChange = async (value: string) => {
    const hours = value === '' ? null : parseFloat(value)
    if (hours !== null && isNaN(hours)) return
    if (hours !== task.actual_hours) {
      await onUpdate?.({ actualHours: hours })
      flashSaved()
    }
  }

  const handleSendEstimate = async () => {
    const cost = estimateInput === '' ? null : parseInt(estimateInput, 10)
    if (cost === null || isNaN(cost) || cost <= 0) {
      toast.error('見積もり金額を入力してください')
      return
    }
    // 状態遷移ガード: approved→pending は禁止 (rejected→pending のみ許可)
    if (task.estimate_status === 'approved') {
      toast.error('クライアント承認済みの見積もりは変更できません')
      return
    }
    // クライアントメンバーがいなければボール渡し不可
    if (clientMembers.length === 0) {
      toast.error('クライアントメンバーが未設定のため、見積もりを送付できません')
      return
    }
    setIsSendingEstimate(true)
    try {
      // ボール渡し先を先に決定
      const clientOwnerIds = clientOwners.length > 0
        ? clientOwners.map(o => o.user_id)
        : [clientMembers[0].id]
      // 見積もり保存
      await onUpdate?.({ estimatedCost: cost, estimateStatus: 'pending' })
      try {
        // ボールをクライアントに渡す
        await onPassBall?.('client', clientOwnerIds)
      } catch {
        // ボール渡し失敗 → 見積もりステータスをロールバック
        await onUpdate?.({ estimateStatus: task.estimate_status === 'rejected' ? 'rejected' : 'none' })
        throw new Error('ボール渡しに失敗しました')
      }
      toast.success('見積もりを送付しました')
    } catch {
      toast.error('見積もり送付に失敗しました')
    } finally {
      setIsSendingEstimate(false)
    }
  }

  const handleMilestoneChange = async (milestoneId: string) => {
    const newMilestoneId = milestoneId || null
    if (newMilestoneId !== task.milestone_id) {
      await onUpdate?.({ milestoneId: newMilestoneId })
      flashSaved()
    }
  }

  const handleAssigneeChange = async (value: string) => {
    // 招待中の人は "invite:<招待ID>" という値で表す（本人のIDと混ざらないようにする）
    if (value.startsWith('invite:')) {
      const inviteId = value.slice('invite:'.length)
      if (inviteId !== task.assignee_invite_id) {
        await onUpdate?.({ assigneeInviteId: inviteId })
        flashSaved()
      }
      return
    }
    const newAssigneeId = value || null
    if (newAssigneeId !== task.assignee_id || (newAssigneeId === null && task.assignee_invite_id)) {
      await onUpdate?.({ assigneeId: newAssigneeId, assigneeInviteId: null })
      flashSaved()
    }
  }

  const handleWikiPageChange = async (wikiPageId: string | null, page?: Pick<WikiPage, 'tags'>) => {
    if (wikiPageId === task.wiki_page_id) return
    if (wikiPageId === null) {
      await onUpdate?.({ wikiPageId: null })
    } else {
      // 紐づけると「検討中→決定→実装済み」の仕様タスクになり、決定するまで完了できない。
      // 候補は全ページなので、議事録などの参考資料を付けただけで完了できなくならないよう、
      // 仕様タスクにするのは「仕様書」タグのページだけにする（参考資料の扱いは CLI の紐づけと同じ）。
      // 作った直後のページはこの時点の一覧に無いので、渡されたページのタグを優先して見る
      const tags = (page ?? wikiPages.find((p) => p.id === wikiPageId))?.tags
      await onUpdate?.({ wikiPageId, wikiPageIsSpec: tags?.includes('仕様書') ?? false })
    }
    flashSaved()
  }

  // その場で作るページは参考資料として紐づける（仕様書の印は付けない＝紐づけても完了を止めない）
  const handleWikiPageCreate = (title: string) => createPage({ title })

  // 不変条件: ball='client' のタスクは client_scope='deliverable' から変更不可
  // （RLS上クライアントから不可視になり、渡した先で誰も動けなくなるため）
  const handleClientScopeChange = async (newScope: ClientScope) => {
    if (task.ball === 'client' && newScope !== 'deliverable') return
    if (newScope === task.client_scope) return
    await onUpdate?.({ clientScope: newScope })
    flashSaved()
  }

  // FR-ASN-003: ボール切り替え時のハンドラー（ペンディング状態対応）
  const handleBallChange = async (newBall: 'client' | 'internal') => {
    if (newBall === 'client') {
      // 外部メンバーがスペースに存在しない場合
      if (clientMembers.length === 0) {
        setOwnerValidationError('スペースに外部メンバーが登録されていません。設定画面からメンバーを追加してください。')
        return
      }

      // 既に外部担当者が設定されている場合はそのまま渡す
      if (clientOwners.length > 0) {
        onPassBall?.(newBall)
        return
      }

      // 外部担当者が未設定 → ペンディング状態に移行して担当者選択UIを開く
      setPendingBallChange('client')
      setOwnerValidationError(null)
      setSelectedClientOwners([])
      setSelectedInternalOwners(internalOwners.map((o) => o.user_id))
      setEditingOwners(true)
      return
    }

    // 「社内」に切り替え: ペンディング状態をキャンセル
    if (pendingBallChange) {
      setPendingBallChange(null)
      setOwnerValidationError(null)
      setEditingOwners(false)
      return
    }

    // client → internal に切り替え時、担当者が社内メンバーでなければ警告
    if (task.ball === 'client' && task.assignee_id && !membersLoading) {
      const isInternalAssignee = internalMembers.some((m) => m.id === task.assignee_id)
      if (!isInternalAssignee) {
        const assignee = clientMembers.find((m) => m.id === task.assignee_id)
          || members.find((m) => m.id === task.assignee_id)
        const assigneeName = assignee?.displayName || '現在の担当者'
        const confirmed = await confirm({
          title: 'ボール切り替え',
          message: `担当者「${assigneeName}」は社内メンバーではありません。ボールを社内に切り替えると、担当者の変更が必要になる場合があります。`,
          confirmLabel: '切り替える',
        })
        if (!confirmed) return
      }
    }
    onPassBall?.(newBall)
  }

  const toggleClientOwner = (ownerId: string) => {
    setSelectedClientOwners((prev) =>
      prev.includes(ownerId)
        ? prev.filter((id) => id !== ownerId)
        : [...prev, ownerId]
    )
  }

  const toggleInternalOwner = (ownerId: string) => {
    setSelectedInternalOwners((prev) =>
      prev.includes(ownerId)
        ? prev.filter((id) => id !== ownerId)
        : [...prev, ownerId]
    )
  }

  const handleSaveOwners = async () => {
    if (isSavingOwners) return
    setIsSavingOwners(true)
    try {
      if (pendingBallChange === 'client') {
        // ボール切替時: 外部担当者必須バリデーション
        if (selectedClientOwners.length === 0) {
          setOwnerValidationError('外部担当者を1人以上選択してください')
          return
        }
        // ボール切替 + オーナー更新を一括実行
        await onPassBall?.('client', selectedClientOwners, selectedInternalOwners)
        setPendingBallChange(null)
        setOwnerValidationError(null)
        setEditingOwners(false)
        return
      }
      // 通常のオーナー更新
      await onUpdateOwners?.(selectedClientOwners, selectedInternalOwners)
      setEditingOwners(false)
    } finally {
      setIsSavingOwners(false)
    }
  }

  const handleCancelPendingBall = () => {
    setPendingBallChange(null)
    setOwnerValidationError(null)
    setEditingOwners(false)
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'タスクを削除',
      message: 'このタスクを削除しますか？この操作は取り消せません。',
      confirmLabel: '削除',
      variant: 'danger',
    })
    if (!ok) return
    setIsDeleting(true)
    try {
      await onDelete?.()
      onClose()
    } catch {
      setIsDeleting(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-surface">
      {ConfirmDialog}
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-medium text-gray-900 truncate">
            タスク詳細
          </h2>
          {showSaved ? (
            <span aria-live="polite" className="flex items-center gap-1 text-xs text-green-600 animate-in fade-in duration-200 flex-shrink-0">
              <Check className="text-xs" weight="bold" />
              保存しました
            </span>
          ) : onUpdate ? (
            <span className="text-[10px] text-gray-400 flex-shrink-0">自動保存</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {onDuplicate && (
            <button
              onClick={onDuplicate}
              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              title="タスクを複製"
            >
              <CopySimple className="text-lg" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              data-testid="task-inspector-delete"
              className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 disabled:opacity-50"
              title="タスクを削除"
            >
              <Trash className="text-lg" />
            </button>
          )}
          <button
            onClick={onClose}
            data-testid="task-inspector-close"
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          >
            <X className="text-lg" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div ref={contentScrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ━━ Group 1: コア情報 ━━ */}

        {/* Title */}
        <div>
          {taskNumber && (
            <div className="mb-1">
              <Tooltip content="タスク番号です。GitHub の PR のタイトルなどに書くと、このタスクにつながります">
                <button
                  type="button"
                  onClick={handleCopyTaskNumber}
                  data-testid="task-inspector-task-number"
                  className="font-mono text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {taskNumberCopied ? 'コピーしました' : taskNumber}
                </button>
              </Tooltip>
            </div>
          )}
          {isEditingTitle ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleTitleSave()
                  if (e.key === 'Escape') {
                    setEditTitle(task.title)
                    setIsEditingTitle(false)
                  }
                }}
                data-testid="task-inspector-title-input"
                className="flex-1 px-2 py-1 text-base font-medium border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              <button
                onClick={handleTitleSave}
                className="p-1 text-green-600 hover:bg-green-50 rounded"
              >
                <Check className="text-sm" />
              </button>
            </div>
          ) : (
            <div
              className="group flex items-center gap-2 cursor-pointer"
              onClick={() => onUpdate && setIsEditingTitle(true)}
            >
              <h3 className="text-base font-medium text-gray-900">{task.title}</h3>
              {onUpdate && (
                <PencilSimple className="text-sm text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </div>
          )}
          {task.ball === 'client' && task.status !== 'done' && (
            <div className="mt-2">
              <Tooltip content="ONでクライアントのポータルに表示されます">
                <AmberBadge>クライアント確認待ち</AmberBadge>
              </Tooltip>
            </div>
          )}
          {showChangesRequestedBadge && (
            <div className="mt-2">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${WARNING.badge}`}>
                クライアントから修正依頼
              </span>
            </div>
          )}
        </div>

        {/* Description — タイトル直下。背景色＋罫線で「どこまでが説明か」を見て分かる領域にする */}
        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <label className="text-xs font-medium text-gray-500">説明</label>
          {isEditingDescription ? (
            <div className="space-y-2">
              <textarea
                // 4行固定だと長い説明を小窓から書くことになるため、中身の量に合わせて伸ばす。
                // ref は編集を開いた直後（既存本文の分の高さ）に一度走る。
                ref={autoGrowDescription}
                value={editDescription}
                onChange={(e) => {
                  setEditDescription(e.target.value)
                  autoGrowDescription(e.currentTarget)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setEditDescription(task.description || '')
                    setIsEditingDescription(false)
                  }
                  // 長文を書き終えてから保存ボタンまでマウスを動かさずに済むようにする。
                  // 修飾キーなしの Enter は通常どおり改行。
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void handleDescriptionSave()
                  }
                }}
                data-testid="task-inspector-description-input"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y max-h-[50vh] overflow-y-auto"
                rows={6}
                autoFocus
              />
              {/* 入力欄が伸びるほど下に押し出されるので、パネルの下端に貼り付けて
                  スクロールせずに押せるようにする。枠(p-3)いっぱいに広げて背景で透けを防ぐ。 */}
              <div className="sticky bottom-0 -mx-3 -mb-3 flex justify-end gap-2 rounded-b-lg border-t border-gray-200 bg-gray-50 px-3 py-2">
                <button
                  onClick={() => {
                    setEditDescription(task.description || '')
                    setIsEditingDescription(false)
                  }}
                  className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleDescriptionSave}
                  className="px-2 py-1 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded"
                >
                  保存
                </button>
              </div>
            </div>
          ) : onUpdate ? (
            <div
              onClick={() => setIsEditingDescription(true)}
              className="group cursor-pointer -mx-2 px-2 py-1.5 rounded border border-transparent hover:border-gray-200 hover:bg-surface min-h-[48px]"
            >
              {task.description ? (
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  <LinkifiedText text={task.description} />
                </p>
              ) : (
                <p className="text-sm text-gray-400">クリックして説明を追加...</p>
              )}
            </div>
          ) : task.description ? (
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              <LinkifiedText text={task.description} />
            </p>
          ) : null}
        </div>

        {/* Spec / Wiki Link — 説明の直下に配置（折りたたみに隠さない） */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
            <FileText className="text-sm" />
            仕様書連携
          </label>
          {onUpdate ? (
            <div className="space-y-3">
              {/* key: Inspector はタスクを切り替えてもアンマウントされないので、打ちかけの検索語を持ち越さない */}
              <WikiPageLinkPicker
                key={task.id}
                pages={wikiPages}
                value={task.wiki_page_id}
                loading={wikiPagesLoading}
                // 手元に一覧が残っていれば、裏の取り直しに失敗しても探す・作るはそのまま使える
                loadError={!!wikiPagesError && wikiPages.length === 0}
                onSelect={handleWikiPageChange}
                onCreate={handleWikiPageCreate}
                testId="task-inspector-wiki-page"
              />
              {task.wiki_page_id && (
                <a
                  href={`/${task.org_id}/project/${task.space_id}/wiki?page=${task.wiki_page_id}`}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                >
                  <LinkIcon className="text-blue-400" />
                  Wikiページを開く
                </a>
              )}
              {!task.wiki_page_id && task.spec_path && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <LinkIcon className="text-gray-400" />
                  <a
                    href={task.spec_path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-600 hover:underline truncate"
                  >
                    {task.spec_path}
                  </a>
                </div>
              )}
            </div>
          ) : (
            <div>
              {task.wiki_page_id ? (
                <a
                  href={`/${task.org_id}/project/${task.space_id}/wiki?page=${task.wiki_page_id}`}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                >
                  <LinkIcon className="text-blue-400" />
                  Wikiページを開く
                </a>
              ) : task.spec_path ? (
                <a
                  href={task.spec_path}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-gray-600 hover:underline truncate"
                >
                  {task.spec_path}
                </a>
              ) : (
                <div className="text-sm text-gray-400">未設定</div>
              )}
            </div>
          )}
        </div>

        {/* ━━ Group 2: ステータス & 担当 ━━ */}
        <div className="border-t border-gray-100" />

        {/* Status + Ball — 横並び1行 */}
        <div className="grid grid-cols-2 gap-3">
          {/* Status */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">ステータス</label>
            {onUpdate ? (
              <select
                value={task.status}
                onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
                data-testid="task-inspector-status"
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-surface"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center gap-2">
                <Circle
                  weight="fill"
                  className={`text-sm ${
                    task.status === 'done'
                      ? 'text-green-500'
                      : task.status === 'in_progress'
                      ? 'text-blue-400'
                      : task.status === 'in_review'
                      ? 'text-amber-400'
                      : 'text-gray-300'
                  }`}
                />
                <span className="text-sm">
                  {STATUS_OPTIONS.find((opt) => opt.value === task.status)?.label || task.status}
                </span>
              </div>
            )}
          </div>

          {/* Ball */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-0.5">
              <label className="text-xs font-medium text-gray-500" title="次にアクションを取る側。社内=チームが作業中、外部=クライアント確認待ち">ボール</label>
              {/* 補足は常時表示せず「?」の中へ。欄が狭く（400pxの右半分）説明文を敷くと
                  ステータス欄とボタンの高さがずれるため。パネルは右寄せで枠内に収める。 */}
              <Hint label="ボール" align="right">
                次にアクションを取る側。外部=クライアントの対応待ち
              </Hint>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => handleBallChange('internal')}
                data-testid="task-inspector-ball-internal"
                className={`flex-1 px-2 py-1.5 rounded border text-sm transition-colors ${
                  task.ball === 'internal' && !pendingBallChange
                    ? 'bg-gray-100 border-gray-300 font-medium'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                社内
              </button>
              <button
                onClick={() => handleBallChange('client')}
                data-testid="task-inspector-ball-client"
                className={`flex-1 px-2 py-1.5 rounded border text-sm transition-colors ${
                  task.ball === 'client' || pendingBallChange === 'client'
                    ? 'bg-amber-50 border-amber-300 font-medium text-amber-700'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center justify-center gap-1">
                  <ArrowRight weight="bold" className="text-xs" />
                  外部
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Client Scope（クライアント公開） */}
        <div className="space-y-1.5">
          {/* 何を切り替える項目か伝わらないため、ボールと同じ「?」ヘルプを添える。
              欄はパネル幅いっぱいなのでパネルは既定の左寄せで収まる。 */}
          <div className="flex items-center gap-1">
            <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
              <Eye className="text-sm" />
              クライアント公開
            </label>
            <Hint label="クライアント公開">
              ONにすると、このタスクがクライアント用の画面（ポータル）に表示されます。OFFなら社内だけに見えます
            </Hint>
          </div>
          {onUpdate ? (
            <div className="flex items-center justify-between px-3 py-2 border border-gray-200 rounded-lg bg-surface">
              <span className={`text-sm ${task.client_scope === 'deliverable' ? `font-medium ${CLIENT.accent}` : 'text-gray-500'}`}>
                {task.client_scope === 'deliverable' ? '公開中' : '非公開'}
              </span>
              <button
                type="button"
                onClick={() => handleClientScopeChange(task.client_scope === 'deliverable' ? 'internal' : 'deliverable')}
                disabled={task.ball === 'client'}
                title={task.ball === 'client' ? '外部ボールのタスクは非公開にできません' : undefined}
                data-testid="task-inspector-client-scope-toggle"
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-60 ${
                  task.client_scope === 'deliverable' ? CLIENT.dot : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-surface rounded-full shadow transition-transform ${
                    task.client_scope === 'deliverable' ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          ) : (
            <div className="text-sm text-gray-700">
              {task.client_scope === 'deliverable' ? '公開中' : '非公開'}
            </div>
          )}
          {task.ball === 'client' && (
            <p className={`text-[10px] ${CLIENT.accent}`}>
              外部ボールのタスクは自動的にクライアント公開になります
            </p>
          )}
        </div>

        {/* Ball inline owner selection */}
        {pendingBallChange === 'client' && (
          <div ref={pendingOwnerRef} className="p-3 bg-amber-50/60 rounded-lg border border-amber-200 space-y-3">
            {ownerValidationError && (
              <p className="text-xs text-red-700 bg-red-50 px-2 py-1.5 rounded border border-red-200">
                {ownerValidationError}
              </p>
            )}
            <div>
              <label className="text-xs font-medium text-amber-700">
                外部担当者を選択
                <span className="text-[10px] ml-1 font-normal text-amber-500">(必須)</span>
              </label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {clientMembers.map((member) => {
                  const isSelected = selectedClientOwners.includes(member.id)
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => {
                        toggleClientOwner(member.id)
                        setOwnerValidationError(null)
                      }}
                      className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                        isSelected
                          ? 'bg-amber-200 border-amber-400 text-amber-800 font-medium'
                          : 'bg-surface border-amber-200 text-amber-600 hover:bg-amber-50'
                      }`}
                    >
                      {member.displayName}
                    </button>
                  )
                })}
              </div>
            </div>
            {internalMembers.length > 0 && (
              <div>
                <label className="text-xs font-medium text-gray-400">社内担当</label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {internalMembers.map((member) => {
                    const isSelected = selectedInternalOwners.includes(member.id)
                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => toggleInternalOwner(member.id)}
                        className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                          isSelected
                            ? 'bg-gray-200 border-gray-300 text-gray-700 font-medium'
                            : 'bg-surface border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        {member.displayName}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={handleCancelPendingBall}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-surface/60 rounded transition-colors"
              >
                やめる
              </button>
              <button
                onClick={handleSaveOwners}
                disabled={isSavingOwners}
                className="px-4 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded transition-colors"
              >
                {isSavingOwners ? '処理中...' : '外部に渡す'}
              </button>
            </div>
          </div>
        )}

        {ownerValidationError && !pendingBallChange && (
          <button
            type="button"
            onClick={() => setOwnerValidationError(null)}
            className="w-full text-left"
          >
            <p className="text-xs text-red-700 bg-red-50 px-3 py-2 rounded-lg border border-red-200 flex items-center justify-between">
              <span>{ownerValidationError}</span>
              <X className="text-sm flex-shrink-0 text-red-400" />
            </p>
          </button>
        )}

        {/* Assignee — ステータス直下 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
            <User className="text-sm" />
            担当者
            {!membersLoading && task.ball === 'internal' && task.assignee_id && !internalMembers.some((m) => m.id === task.assignee_id) && (
              <span className="text-[10px] text-red-600 ml-1">
                ⚠ 社内メンバーに変更推奨
              </span>
            )}
          </label>
          {onUpdate ? (
            <select
              value={task.assignee_invite_id ? `invite:${task.assignee_invite_id}` : task.assignee_id || ''}
              onChange={(e) => handleAssigneeChange(e.target.value)}
              data-testid="task-inspector-assignee"
              className={`w-full px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-surface ${
                !membersLoading && task.ball === 'internal' && task.assignee_id && !internalMembers.some((m) => m.id === task.assignee_id)
                  ? 'border-red-300 bg-red-50'
                  : 'border-gray-200'
              }`}
            >
              <option value="">未設定</option>
              {internalMembers.length > 0 && (
                <optgroup label="社内メンバー">
                  {internalMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </optgroup>
              )}
              {pendingInvites.length > 0 && (
                <optgroup label="招待中（承諾すると自動で引き継ぎ）">
                  {pendingInvites.map((inv) => (
                    <option key={inv.id} value={`invite:${inv.id}`}>
                      {pendingInviteLabel(inv)}
                    </option>
                  ))}
                </optgroup>
              )}
              {(task.ball === 'client' || pendingBallChange === 'client') && clientMembers.length > 0 && (
                <optgroup label="外部メンバー">
                  {clientMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </optgroup>
              )}
              {task.assignee_id && !internalMembers.some((m) => m.id === task.assignee_id) && !clientMembers.some((m) => m.id === task.assignee_id) && (() => {
                const currentAssignee = members.find((m) => m.id === task.assignee_id)
                if (!currentAssignee) return null
                // vendor（協力会社）は internalMembers にも clientMembers にも含まれない
                // 役割なので、ここに来る。「(不明)」ではなく役割の分かる表示にする。
                // 呼び方は画面のほかの所（設定 > メンバー等）と同じ正本(spaceRoles.ts)から取る
                const label = currentAssignee.role === 'vendor' ? SPACE_ROLE_LABELS.vendor : '不明'
                return (
                  <option key={currentAssignee.id} value={currentAssignee.id}>
                    {currentAssignee.displayName} ({label})
                  </option>
                )
              })()}
            </select>
          ) : (
            <div className="text-sm text-gray-700">
              {task.assignee_id ? getMemberName(task.assignee_id) : '未設定'}
            </div>
          )}
        </div>

        {/* Review Section */}
        <TaskReviewSection
          taskId={task.id}
          spaceId={spaceId}
          orgId={task.org_id}
          taskStatus={task.status}
          readOnly={!onUpdate}
          onReviewChange={onReviewChange}
        />

        {/* ━━ Group 3: スケジュール ━━ */}
        <div className="border-t border-gray-100" />
        <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">スケジュール</div>

        {/* Start Date + Due Date — 横並び */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">開始日</label>
            {onUpdate ? (
              <div className="flex items-center gap-1.5">
                <Calendar className="text-gray-400 text-sm flex-shrink-0" />
                <input
                  type="date"
                  value={task.start_date?.split('T')[0] || ''}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  data-testid="task-inspector-start-date"
                  className="flex-1 min-w-0 px-1.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            ) : task.start_date ? (
              <div className="flex items-center gap-1.5 text-sm text-gray-700">
                <Calendar className="text-gray-400 text-sm" />
                <span>{new Date(task.start_date).toLocaleDateString('ja-JP')}</span>
              </div>
            ) : (
              <div className="text-sm text-gray-400">未設定</div>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">期限</label>
            {task.due_authority_connection_id ? (
              // AI秘書 Stage5 期限リマインド PR-0(§2.1/§5.2): external権威タスクは期限が読み取り専用。
              // DB層(trg_guard_external_due)が最終防衛線だが、UIでも編集できないことを明示する
              // (誤操作の一瞬の楽観更新→ロールバックを避け、出所も示す)。
              <div className="space-y-0.5">
                {task.due_date ? (
                  <div className="flex items-center gap-1.5 text-sm text-gray-700">
                    <Calendar className="text-gray-400 text-sm" />
                    <span>{new Date(task.due_date).toLocaleDateString('ja-JP')}</span>
                  </div>
                ) : (
                  <div className="text-sm text-gray-400">未設定</div>
                )}
                <p className="text-xs text-gray-400">期限は連携元ツール（Google Tasks など）で管理しています</p>
              </div>
            ) : onUpdate ? (
              <div className="flex items-center gap-1.5">
                <Calendar className="text-gray-400 text-sm flex-shrink-0" />
                <input
                  type="date"
                  value={task.due_date?.split('T')[0] || ''}
                  onChange={(e) => handleDueDateChange(e.target.value)}
                  data-testid="task-inspector-due-date"
                  className="flex-1 min-w-0 px-1.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            ) : task.due_date ? (
              <div className="flex items-center gap-1.5 text-sm text-gray-700">
                <Calendar className="text-gray-400 text-sm" />
                <span>{new Date(task.due_date).toLocaleDateString('ja-JP')}</span>
              </div>
            ) : (
              <div className="text-sm text-gray-400">未設定</div>
            )}
          </div>
        </div>

        {/* 時刻指定リマインド（③・pro以上限定・LINE/Slack等の紐づくチャットへ） */}
        {onUpdate && (
          <TaskReminderField
            taskId={task.id}
            initialRemindAt={(task as { remind_at?: string | null }).remind_at ?? null}
            orgId={task.org_id}
          />
        )}

        {/* Milestone */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
            <Flag className="text-sm" />
            マイルストーン
          </label>
          {onUpdate ? (
            <select
              value={task.milestone_id || ''}
              onChange={(e) => handleMilestoneChange(e.target.value)}
              data-testid="task-inspector-milestone"
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-surface"
            >
              <option value="">未設定</option>
              {milestones.map((ms) => (
                <option key={ms.id} value={ms.id}>
                  {ms.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="text-sm text-gray-700">
              {milestones.find((ms) => ms.id === task.milestone_id)?.name || '未設定'}
            </div>
          )}
        </div>

        {/* Completed At (shown when task is done) */}
        {task.status === 'done' && task.completed_at && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">完了日</label>
            <div className="text-sm text-gray-700">
              {new Date(task.completed_at).toLocaleDateString('ja-JP', {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </div>
          </div>
        )}

        {/* Actual Hours (shown when task is done) */}
        {task.status === 'done' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
              <Timer className="text-sm" />
              実績工数
            </label>
            {onUpdate ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={task.actual_hours ?? ''}
                  onChange={(e) => handleActualHoursChange(e.target.value)}
                  placeholder="0.0"
                  data-testid="task-inspector-actual-hours"
                  className="w-24 px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-xs text-gray-500">時間</span>
              </div>
            ) : task.actual_hours != null ? (
              <div className="text-sm text-gray-700">
                {task.actual_hours}h
              </div>
            ) : (
              <div className="text-sm text-gray-400">未入力</div>
            )}
          </div>
        )}

        {/* Estimate Section */}
        {task.status !== 'done' && task.client_scope === 'deliverable' && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
              <CurrencyJpy className="text-sm" />
              見積もり
            </label>

            {/* Status indicator */}
            {task.estimate_status === 'pending' && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 border border-amber-200 rounded-lg">
                <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
                <span className="text-xs font-medium text-amber-700">クライアント確認中</span>
                {task.estimated_cost != null && (
                  <span className="ml-auto text-xs font-semibold text-amber-800">
                    ¥{task.estimated_cost.toLocaleString()}
                  </span>
                )}
              </div>
            )}
            {task.estimate_status === 'approved' && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-green-50 border border-green-200 rounded-lg">
                <Check className="w-3.5 h-3.5 text-green-600" weight="bold" />
                <span className="text-xs font-medium text-green-700">クライアント承認済み</span>
                {task.estimated_cost != null && (
                  <span className="ml-auto text-xs font-semibold text-green-800">
                    ¥{task.estimated_cost.toLocaleString()}
                  </span>
                )}
              </div>
            )}
            {task.estimate_status === 'rejected' && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-red-50 border border-red-200 rounded-lg">
                <span className="text-xs font-medium text-red-700">再見積もり依頼</span>
                {task.estimated_cost != null && (
                  <span className="ml-auto text-xs font-semibold text-red-800 line-through">
                    ¥{task.estimated_cost.toLocaleString()}
                  </span>
                )}
              </div>
            )}

            {/* Input + Send (visible when editable, not pending, not approved) */}
            {onUpdate && task.estimate_status !== 'pending' && task.estimate_status !== 'approved' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">¥</span>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={estimateInput}
                    onChange={(e) => setEstimateInput(e.target.value)}
                    placeholder="100,000"
                    data-testid="task-inspector-estimated-cost"
                    className="w-32 px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {onPassBall && (
                  <button
                    type="button"
                    onClick={handleSendEstimate}
                    disabled={isSendingEstimate || !estimateInput || parseInt(estimateInput, 10) <= 0}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSendingEstimate ? (
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <ArrowRight className="w-4 h-4" />
                    )}
                    見積もりを送付
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Agency Mode: Pricing Panel (admin/editor only) */}
        {/* isInternalMember は viewer も真になるため使わない。onUpdate の有無（社内の編集者なら
            真）でもない — DB のガード(guard_task_pricing_write/delete)は space_memberships の
            行がはっきり admin/editor の人だけで、行が無い社内メンバーは対象外（app_can_write_space
            より狭い）。呼び出し元が canEditSpaceMoney で判定した値を canEditPricing として渡す */}
        {agencyData.agency_mode && canEditPricing && (
          <TaskPricingPanel
            taskId={task.id}
            orgId={task.org_id}
            spaceId={spaceId}
            defaultMarginRate={agencyData.default_margin_rate}
          />
        )}

        {/* ━━ Group 4: 詳細設定 (折りたたみ) ━━ */}
        <div className="border-t border-gray-100" />

        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1.5 w-full text-left"
        >
          {showDetails ? <CaretDown className="text-xs text-gray-400" /> : <CaretRight className="text-xs text-gray-400" />}
          <span className="text-xs font-medium text-gray-500">詳細設定</span>
          {detailCount > 0 && !showDetails && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
              {detailCount}件設定済み
            </span>
          )}
        </button>

        {showDetails && (
          <div className="space-y-4 pl-1">
            {/* Parent Task */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
                <TreeStructure className="text-sm" />
                親タスク
              </label>
              {onUpdate ? (
                <select
                  value={task.parent_task_id || ''}
                  onChange={(e) => { onUpdate?.({ parentTaskId: e.target.value || null }); flashSaved() }}
                  data-testid="task-inspector-parent"
                  className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-surface"
                >
                  <option value="">なし</option>
                  {parentTasks.map((pt) => (
                    <option key={pt.id} value={pt.id}>
                      {pt.title}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-sm text-gray-700">
                  {task.parent_task_id
                    ? parentTasks.find((pt) => pt.id === task.parent_task_id)?.title || task.parent_task_id
                    : 'なし'}
                </div>
              )}
            </div>

            {/* Child Tasks */}
            {childTasks.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
                  <TreeStructure className="text-sm" />
                  子タスク
                  <span className="text-[10px] text-gray-400 ml-1">({childTasks.length}件)</span>
                </label>
                <div className="space-y-1">
                  {childTasks.map((child) => (
                    <div
                      key={child.id}
                      className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded text-sm"
                    >
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{
                          backgroundColor:
                            child.ball === 'client' ? '#F59E0B' : '#3B82F6',
                        }}
                      />
                      <TruncatedText className={`flex-1 ${child.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                        {child.title}
                      </TruncatedText>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Owners (実行担当) */}
            {shouldShowOwnerField && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-gray-500">実行担当</label>
                  {onUpdateOwners && !editingOwners && (
                    <button
                      onClick={handleStartEditingOwners}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      編集
                    </button>
                  )}
                </div>

                {editingOwners ? (
                  <div className="space-y-3 p-3 bg-gray-50 rounded-lg">
                    {clientMembers.length > 0 && (
                      <div>
                        <label className="text-xs font-medium text-amber-600">外部担当</label>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {clientMembers.map((member) => {
                            const isSelected = selectedClientOwners.includes(member.id)
                            return (
                              <button
                                key={member.id}
                                type="button"
                                onClick={() => toggleClientOwner(member.id)}
                                className={`px-2 py-1 text-xs rounded border transition-colors ${
                                  isSelected
                                    ? 'bg-amber-100 border-amber-300 text-amber-700 font-medium'
                                    : 'border-gray-200 text-gray-600 hover:bg-gray-100'
                                }`}
                              >
                                {member.displayName}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    {internalMembers.length > 0 && (
                      <div>
                        <label className="text-xs font-medium text-gray-500">社内担当</label>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {internalMembers.map((member) => {
                            const isSelected = selectedInternalOwners.includes(member.id)
                            return (
                              <button
                                key={member.id}
                                type="button"
                                onClick={() => toggleInternalOwner(member.id)}
                                className={`px-2 py-1 text-xs rounded border transition-colors ${
                                  isSelected
                                    ? 'bg-gray-200 border-gray-400 text-gray-700 font-medium'
                                    : 'border-gray-200 text-gray-600 hover:bg-gray-100'
                                }`}
                              >
                                {member.displayName}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        onClick={() => setEditingOwners(false)}
                        className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 rounded"
                      >
                        キャンセル
                      </button>
                      <button
                        onClick={handleSaveOwners}
                        disabled={isSavingOwners}
                        className="px-2 py-1 text-xs text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded"
                      >
                        {isSavingOwners ? '保存中...' : '保存'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {clientOwners.length > 0 && (
                      <div>
                        <div className="text-xs text-amber-600 mb-1">外部</div>
                        <div className="flex flex-wrap gap-1">
                          {clientOwners.map((owner) => (
                            <span
                              key={owner.id}
                              className="px-2 py-0.5 text-xs bg-amber-50 text-amber-700 rounded"
                            >
                              {getMemberName(owner.user_id)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {internalOwners.length > 0 && (
                      <div>
                        <div className="text-xs text-gray-500 mb-1">社内</div>
                        <div className="flex flex-wrap gap-1">
                          {internalOwners.map((owner) => (
                            <span
                              key={owner.id}
                              className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded"
                            >
                              {getMemberName(owner.user_id)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {clientOwners.length === 0 && internalOwners.length === 0 && (
                      <div className="text-sm text-gray-400">未設定</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Milestone Wiki (PR3): このマイルストーンに紐づく Wiki への導線。0件・milestone未設定なら非表示。
                prefetch={false}: 最大6本のリンクが画面に入った時点で先読みされるのを避ける（上の Wiki リンクも先読みなし） */}
            {milestoneWikiPages.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-500">このマイルストーンの Wiki</label>
                <div className="space-y-1">
                  {milestoneWikiPages.map((page) => (
                    <NextLink
                      key={page.id}
                      href={`/${task.org_id}/project/${task.space_id}/wiki?page=${page.id}`}
                      prefetch={false}
                      className="flex items-center gap-1.5 text-sm text-gray-700 hover:underline min-w-0"
                    >
                      {page.pinned_at != null && (
                        <PushPin weight="fill" className="text-gray-400 text-xs flex-shrink-0" aria-hidden="true" />
                      )}
                      <BookOpen className="text-gray-400 flex-shrink-0" />
                      <span className="truncate">{page.title}</span>
                    </NextLink>
                  ))}
                  {milestoneWikiTotalCount > milestoneWikiPages.length && (
                    <NextLink
                      href={`/${task.org_id}/project/${task.space_id}/wiki`}
                      prefetch={false}
                      className="block text-xs text-gray-500 hover:underline"
                    >
                      他 {milestoneWikiTotalCount - milestoneWikiPages.length} 件を Wiki で見る
                    </NextLink>
                  )}
                </div>
              </div>
            )}

            {/* Spec workflow — only for spec tasks */}
            {task.type === 'spec' && (
              <div className="space-y-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <label className="text-xs font-medium text-gray-500">仕様ステータス</label>
                {task.decision_state && (
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-1 rounded font-medium ${
                        task.decision_state === 'implemented'
                          ? 'bg-green-50 text-green-700'
                          : task.decision_state === 'decided'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {task.decision_state === 'implemented'
                        ? '実装済み'
                        : task.decision_state === 'decided'
                        ? '決定済み'
                        : '検討中'}
                    </span>
                  </div>
                )}
                {onSetSpecState && task.decision_state === 'decided' && (
                  <div className="pt-2 space-y-2 border-t border-gray-200">
                    {(!specConfirmClickTime || specConfirmTaskId !== task.id) && (
                      <button
                        onClick={() => {
                          if (task.wiki_page_id) {
                            window.open(
                              `/${task.org_id}/project/${task.space_id}/wiki?page=${task.wiki_page_id}`,
                              '_blank',
                              'noopener,noreferrer'
                            )
                            setSpecConfirmClickTime(Date.now())
                            setSpecConfirmTaskId(task.id)
                          } else if (task.spec_path) {
                            try {
                              const url = new URL(task.spec_path)
                              if (!['http:', 'https:'].includes(url.protocol)) {
                                toast.error('無効なURLスキームです')
                                return
                              }
                              window.open(task.spec_path, '_blank', 'noopener,noreferrer')
                              setSpecConfirmClickTime(Date.now())
                              setSpecConfirmTaskId(task.id)
                            } catch {
                              toast.error('無効なURLです')
                            }
                          }
                        }}
                        disabled={!task.wiki_page_id && !task.spec_path}
                        data-testid="spec-confirm-open"
                        className={`w-full px-3 py-2 text-sm rounded-lg transition-colors ${
                          (task.wiki_page_id || task.spec_path)
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        仕様を確認する
                      </button>
                    )}
                    {specConfirmClickTime && specConfirmTaskId === task.id && (
                      <>
                        <div className="text-xs text-gray-600">
                          仕様を確認しました。実装が完了したら下のボタンを押してください。
                          <br />
                          <span className="text-gray-500">(10分以内に完了してください)</span>
                        </div>
                        <button
                          onClick={async () => {
                            const elapsed = Date.now() - specConfirmClickTime
                            const tenMinutes = 10 * 60 * 1000
                            if (elapsed > tenMinutes) {
                              toast.error('10分を超えました。再度「仕様を確認する」を押してください。')
                              setSpecConfirmClickTime(null)
                              setSpecConfirmTaskId(null)
                              return
                            }
                            setIsSettingSpecState(true)
                            try {
                              await onSetSpecState('implemented')
                              setSpecConfirmClickTime(null)
                              setSpecConfirmTaskId(null)
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : '状態の更新に失敗しました')
                            } finally {
                              setIsSettingSpecState(false)
                            }
                          }}
                          disabled={isSettingSpecState}
                          data-testid="spec-mark-implemented"
                          className="w-full px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                        >
                          {isSettingSpecState ? '処理中...' : '実装完了にする'}
                        </button>
                        <button
                          onClick={() => {
                            setSpecConfirmClickTime(null)
                            setSpecConfirmTaskId(null)
                          }}
                          className="w-full px-3 py-1 text-xs text-gray-500 hover:text-gray-700"
                        >
                          キャンセル
                        </button>
                      </>
                    )}
                  </div>
                )}
                {onSetSpecState && task.decision_state === 'considering' && (
                  <div className="pt-2 border-t border-gray-200">
                    <button
                      onClick={async () => {
                        if (!task.wiki_page_id && !task.spec_path) {
                          toast.error('仕様書が紐付けられていません')
                          return
                        }
                        setIsSettingSpecState(true)
                        try {
                          await onSetSpecState('decided')
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : '状態の更新に失敗しました')
                        } finally {
                          setIsSettingSpecState(false)
                        }
                      }}
                      disabled={(!task.wiki_page_id && !task.spec_path) || isSettingSpecState}
                      data-testid="spec-mark-decided"
                      className={`w-full px-3 py-2 text-sm rounded-lg transition-colors ${
                        (task.wiki_page_id || task.spec_path) && !isSettingSpecState
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      }`}
                    >
                      {isSettingSpecState ? '処理中...' : '決定済みにする'}
                    </button>

                    {/* AT-007: 会議外でクライアント確定として登録 */}
                    {clientMembers.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <ConsideringDecisionPanel
                          taskId={task.id}
                          spaceId={spaceId}
                          clientMembers={clientMembers}
                          onDecided={onConsideringDecided}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ━━ Group 5: アクティビティ ━━ */}
        <div className="border-t border-gray-100" />

        {/* GitHub PRs */}
        <TaskPRList
          taskId={task.id}
          spaceId={spaceId}
          orgId={task.org_id}
          readOnly={!onUpdate}
        />

        {/* GitHub Issues */}
        <TaskIssueList
          taskId={task.id}
          spaceId={spaceId}
          orgId={task.org_id}
          readOnly={!onUpdate}
        />

        {/* Slack */}
        <SlackPostButton taskId={task.id} spaceId={spaceId} />

        {/* Comments (collapsed by default) */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowComments(!showComments)}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors w-full"
          >
            <ChatCircleText className="text-sm" />
            <span>コメント</span>
            {showComments ? <CaretDown className="text-xs" /> : <CaretRight className="text-xs" />}
          </button>
          {showComments && (
            <TaskComments
              orgId={task.org_id}
              spaceId={spaceId}
              taskId={task.id}
              currentUserId={currentUserId}
              clientOnly={false}
              canSetVisibility={isInternalMember}
            />
          )}
        </div>

        {/* History / audit trail (collapsed by default) */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors w-full"
          >
            <Timer className="text-sm" />
            <span>履歴</span>
            {showHistory ? <CaretDown className="text-xs" /> : <CaretRight className="text-xs" />}
          </button>
          {showHistory && (
            <TaskEventTimeline taskId={task.id} getMemberName={getMemberName} />
          )}
        </div>
      </div>
    </div>
  )
}
