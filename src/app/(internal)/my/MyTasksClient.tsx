'use client'

import { useEffect, useState, useMemo, useCallback, useContext, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useQueryClient } from '@tanstack/react-query'
import { Target, Folder, CaretDown, CaretRight, FunnelSimple, SortAscending, SortDescending, X, Plus } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { rpc } from '@/lib/supabase/rpc'
import { TaskRow } from '@/components/task/TaskRow'
import { useInspector } from '@/components/layout'
import { useTasks } from '@/lib/hooks/useTasks'
import type { TasksQueryData } from '@/lib/hooks/useTasks'
import { getEligibleParents } from '@/lib/gantt/treeUtils'
import type { Task, Space, Milestone, TaskStatus, ReviewStatus } from '@/types/database'
import { splitEmbeddedReviews, type EmbeddedReviews } from '@/lib/tasks/reviewStatus'
import type { SupabaseClient } from '@supabase/supabase-js'
import { EmptyState, ErrorRetry, LoadingState } from '@/components/shared'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'
import type { TaskCreateData } from '@/components/task/TaskCreateSheet'
import { AnnouncementBell } from '@/components/announcement/AnnouncementBell'
import { DEFAULT_STALE_TIME_MS } from '@/lib/query/constants'

const TaskCreateSheet = dynamic(
  () => import('@/components/task/TaskCreateSheet').then((m) => ({ default: m.TaskCreateSheet })),
  { ssr: false }
)

const TaskInspector = dynamic(
  () => import('@/components/task/TaskInspector').then((m) => ({ default: m.TaskInspector })),
  { ssr: false }
)

// Development mode fallback user ID
const DEV_USER_ID = '0124bcca-7c66-406c-b1ae-2be8dac241c5'
const STORAGE_KEY = 'my-tasks-collapsed-milestones'
const FILTER_STORAGE_KEY = 'my-tasks-filters'

type SortField = 'due_date' | 'created_at' | 'priority' | 'title'
type SortOrder = 'asc' | 'desc'
type StatusFilter = 'all' | 'todo' | 'in_progress' | 'in_review'

interface FilterState {
  status: StatusFilter
  spaceId: string | null
  showCompleted: boolean
  sortField: SortField
  sortOrder: SortOrder
}

const defaultFilters: FilterState = {
  status: 'all',
  spaceId: null,
  showCompleted: false,
  sortField: 'due_date',
  sortOrder: 'asc',
}

interface TaskGroup {
  space: Space | null
  milestoneGroups: {
    milestone: Milestone | null
    tasks: Task[]
  }[]
}

function loadCollapsedState(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return new Set(JSON.parse(stored))
    }
  } catch {
    // ignore
  }
  return new Set()
}

function saveCollapsedState(collapsed: Set<string>) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(collapsed)))
  } catch {
    // ignore
  }
}

function loadFilterState(): FilterState {
  if (typeof window === 'undefined') return defaultFilters
  try {
    const stored = localStorage.getItem(FILTER_STORAGE_KEY)
    if (stored) {
      return { ...defaultFilters, ...JSON.parse(stored) }
    }
  } catch {
    // ignore
  }
  return defaultFilters
}

function saveFilterState(filters: FilterState) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters))
  } catch {
    // ignore
  }
}

const statusLabels: Record<StatusFilter, string> = {
  all: 'すべて',
  todo: '着手予定',
  in_progress: '進行中',
  in_review: '社内承認中',
}

const sortLabels: Record<SortField, string> = {
  due_date: '期限',
  created_at: '作成日',
  priority: '優先度',
  title: 'タイトル',
}

interface MyTaskInspectorProps {
  task: Task
  /**
   * このタスクを開いた時刻（Date.now()）。表示の許容誤差(SHOW_TOLERANCE_MS)の基準に使う。
   * 一覧の読み込み時刻(listFetchedAt)を基準にすると、/my を開いたまま30分放置してから
   * タスクを押した場合に31分前のキャッシュを即表示してしまう。「開いた瞬間」を基準にする
   * ことでそれを防ぐ。イベントハンドラ(selectTask)側で記録し、レンダー中には計算しない。
   * 初期表示の `?task=` ディープリンクだけは押した瞬間が無いため listFetchedAt で代用する。
   */
  openedAt: number
  /**
   * /my の一覧を読み込み始めた時刻（Date.now()）。useTasks が持つプロジェクト単位の
   * キャッシュが、この時刻より新しく更新されているかどうかで「一覧と同じくらい新しいか」
   * を判定する（古い永続キャッシュ(IndexedDB)で担当者[]のまま出してしまう事故を防ぐ）。
   * バックグラウンド更新の要否・一覧への同期の要否は、表示の許容誤差とは別にこちらを使う
   * （openedAt はあくまで「表示していいか」の基準で、データの新旧そのものの基準ではない）。
   */
  listFetchedAt: number
  onClose: () => void
  /** reviewStatus は詳細（プロジェクト単位の読み込み結果）が持つ、最新の社内承認の状態 */
  onSynced: (task: Task, reviewStatus: ReviewStatus | undefined) => void
  onDeleted: (taskId: string) => void
}

/**
 * 一覧より少しくらい古いキャッシュなら、そのまま見せてよい許容誤差。QueryProvider の
 * staleTime と同じ値（DEFAULT_STALE_TIME_MS）を使う — プロジェクト画面自身が
 * 「staleTime以内はキャッシュを信頼する」のだから、詳細パネルにも同じだけの信頼を与える
 * （毎回ネットワークを待たせない）。
 *
 * この理屈は react-query の既定動作（refetchOnMount: データが staleTime を過ぎていたら
 * マウント時に自動で取り直す）に依存している。staleTime そのもの・refetchOnMount の
 * 既定を変える場合は、この許容誤差の妥当性も一緒に見直すこと。
 *
 * 表示の可否はこの許容誤差付きで判定し、バックグラウンド更新の要否は厳密な新旧比較で判定する
 * （isStale は invalidate/refetch のたびに true になり、編集中の詳細がスピナーに化けてしまうため使わない）。
 */
const SHOW_TOLERANCE_MS = DEFAULT_STALE_TIME_MS

/**
 * 選んだタスクの詳細を右側(Inspector)に出す。更新はプロジェクト画面と同じ useTasks を通す
 * （承認メール・通知などの副作用をそろえるため）。そのプロジェクトのタスクは親タスク候補・
 * 子タスクの表示にも要る。useTasks はそのプロジェクトの全タスクを読み込むため、担当者は
 * 自然に揃う。担当者が揃うまでは TaskInspector を出さない。
 */
function MyTaskInspector({ task, openedAt, listFetchedAt, onClose, onSynced, onDeleted }: MyTaskInspectorProps) {
  const { setInspector } = useInspector()

  // TaskInspector 自体（コード）は、データが揃うのを待たずマウント時点から先読みしておく。
  // 待ってから import すると「データ取得→chunk取得→内部の追加取得」が直列になってしまう。
  useEffect(() => {
    void import('@/components/task/TaskInspector')
  }, [])

  const { tasks, owners, reviewStatuses, loading, error, dataUpdatedAt, isFetching, fetchTasks, updateTask, deleteTask, passBall, handleReviewChange } = useTasks({
    orgId: task.org_id,
    spaceId: task.space_id,
  })
  const spaceTask = tasks.find((t) => t.id === task.id)
  const current = spaceTask ?? task

  // 削除中は「消えた」を一覧に古いデータで上書きしたり、削除リクエストと再取得が
  // 競合したりしないよう、以降の判定をすべて止める（詳細は onDelete 参照）
  const [deleting, setDeleting] = useState(false)

  // 開いた時刻(openedAt)より SHOW_TOLERANCE_MS だけ古いところまでは、そのまま表示してよい
  // （プロジェクト画面のキャッシュと同じだけ信頼する）。listFetchedAt ではなく openedAt を
  // 基準にするのは、/my を開いたまま放置してからタスクを押したケースを考慮するため。
  const recentEnough = dataUpdatedAt >= openedAt - SHOW_TOLERANCE_MS
  const canShow = !loading && !!spaceTask && recentEnough && !deleting

  // 表示は許容誤差つきで進めつつ、裏では厳密な新旧比較で「一覧より古い／担当者が
  // まだ無い」場合に限り、listFetchedAt ごとに1回だけ更新を要求する（不要な待たせをしない）。
  // 取得済みエラーがある間は自動で再要求しない — 復帰は ErrorRetry の再試行ボタンに任せる
  // （さもないと ErrorRetry→スピナー→ErrorRetry のちらつきになる）
  const [doneForListFetchedAt, setDoneForListFetchedAt] = useState<number | null>(null)
  const requestedForRef = useRef<number | null>(null)
  useEffect(() => {
    if (loading || isFetching || deleting || error) return
    if (spaceTask && dataUpdatedAt >= listFetchedAt) return
    if (requestedForRef.current === listFetchedAt) return
    requestedForRef.current = listFetchedAt
    fetchTasks().finally(() => setDoneForListFetchedAt(listFetchedAt))
  }, [loading, isFetching, deleting, error, spaceTask, dataUpdatedAt, listFetchedAt, fetchTasks])
  const notFound = doneForListFetchedAt === listFetchedAt && !spaceTask && !isFetching && !error && !deleting

  // 詳細で変えた内容を一覧にも映す。一覧の取得時刻より新しいデータになったときだけ同期する
  // （古いキャッシュ・削除中で一覧側を上書きしない）
  const onSyncedRef = useRef(onSynced)
  useEffect(() => {
    onSyncedRef.current = onSynced
  })
  // 社内承認の状態も一緒に映す（詳細から承認を依頼したら、一覧の「社内承認を依頼」を「社内承認待ち」に変える）
  const spaceReviewStatus = reviewStatuses[task.id]
  useEffect(() => {
    if (spaceTask && dataUpdatedAt >= listFetchedAt && !deleting) onSyncedRef.current(spaceTask, spaceReviewStatus)
  }, [spaceTask, spaceReviewStatus, dataUpdatedAt, listFetchedAt, deleting])

  useEffect(() => () => setInspector(null), [setInspector])

  // プレースホルダの種類はレンダー中に計算しておき、setInspector エフェクトの依存には
  // これ1つだけを使う。isFetching/error を直接依存に入れると、揃って表示中
  // (canShow=true)の裏で走るバックグラウンド再取得(isFetching の一時的な変化)のたびに
  // 準備済みの TaskInspector 要素を作り直すことになってしまう（canShow=true の間、
  // placeholderKind は null のまま変化しない）
  const placeholderKind: 'error' | 'notFound' | 'loading' | null = canShow
    ? null
    : error && !isFetching
      ? 'error'
      : notFound
        ? 'notFound'
        : 'loading'

  useEffect(() => {
    if (placeholderKind !== null) {
      let body: React.ReactNode
      if (placeholderKind === 'error') {
        body = (
          <ErrorRetry
            message="タスクを読み込めませんでした"
            onRetry={() => {
              void fetchTasks()
            }}
          />
        )
      } else if (placeholderKind === 'notFound') {
        body = (
          <p className="text-sm text-gray-500">
            このタスクを開けませんでした。削除されたか、見る権限がない可能性があります。
          </p>
        )
      } else {
        body = <LoadingState />
      }
      setInspector(
        <div className="h-full flex flex-col bg-surface">
          <div className="h-12 flex items-center justify-between px-4 border-b border-gray-100 flex-shrink-0">
            <h2 className="text-sm font-medium text-gray-900 truncate">{task.title}</h2>
            <button
              onClick={onClose}
              aria-label="閉じる"
              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            >
              <X className="text-lg" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">{body}</div>
        </div>
      )
      return
    }

    const taskOwners = owners[current.id] || []
    setInspector(
      <TaskInspector
        key={current.space_id}
        task={current}
        spaceId={current.space_id}
        owners={taskOwners}
        parentTasks={getEligibleParents(tasks, current.id).map((t) => ({ id: t.id, title: t.title }))}
        childTasks={tasks.filter((t) => t.parent_task_id === current.id)}
        onClose={onClose}
        onPassBall={async (ball, overrideClientOwnerIds, overrideInternalOwnerIds) => {
          const clientOwnerIds = overrideClientOwnerIds ?? taskOwners
            .filter((owner) => owner.side === 'client')
            .map((owner) => owner.user_id)
          const internalOwnerIds = overrideInternalOwnerIds ?? taskOwners
            .filter((owner) => owner.side === 'internal')
            .map((owner) => owner.user_id)
          // バリデーションはTaskInspector側で処理済み（フォールバック用のみ残す）
          if (ball === 'client' && clientOwnerIds.length === 0) return
          await passBall(current.id, ball, clientOwnerIds, internalOwnerIds)
        }}
        onUpdate={(updates) => updateTask(current.id, updates)}
        onDelete={async () => {
          // 楽観的更新で spaceTask が先に消えるため、削除リクエスト中は notFound 判定・
          // 背景更新の再取得（消えたタスクを復活させかねない）を止める
          setDeleting(true)
          try {
            await deleteTask(current.id)
            onDeleted(current.id)
          } catch (err) {
            setDeleting(false)
            throw err
          }
        }}
        onUpdateOwners={(clientOwnerIds, internalOwnerIds) =>
          passBall(current.id, current.ball, clientOwnerIds, internalOwnerIds)
        }
        onSetSpecState={
          current.type === 'spec'
            ? async (decisionState) => {
                if (decisionState !== 'considering' && !current.wiki_page_id && !current.spec_path) {
                  throw new Error('仕様書のWikiページが紐付けられていません')
                }
                await rpc.setSpecState(createClient(), { taskId: current.id, decisionState })
                await fetchTasks()
              }
            : undefined
        }
        onConsideringDecided={fetchTasks}
        onReviewChange={handleReviewChange}
      />
    )
  }, [placeholderKind, task.title, current, tasks, owners, onClose, onDeleted, setInspector, fetchTasks, updateTask, deleteTask, passBall, handleReviewChange])

  return null
}

export default function MyTasksClient() {
  const [tasks, setTasks] = useState<Task[]>([])
  // 行の完了トグル(updateTaskStatus)を tasks の変更のたびに作り直さない（TaskRow の memo を効かせる）ための ref
  const tasksRef = useRef(tasks)
  useEffect(() => {
    tasksRef.current = tasks
  })
  const [spaces, setSpaces] = useState<Space[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  // タスクごとの最新の社内承認の状態。無いと「社内承認中」の行すべてに「社内承認を依頼」が出てしまう
  const [reviewStatuses, setReviewStatuses] = useState<Record<string, ReviewStatus>>({})
  const [userId, setUserId] = useState<string | null>(null)
  const [collapsedMilestones, setCollapsedMilestones] = useState<Set<string>>(new Set())
  const [filters, setFilters] = useState<FilterState>(defaultFilters)
  const [showFilters, setShowFilters] = useState(false)
  // /my の一覧を読み込み始めた時刻。MyTaskInspector 側で「useTasks のキャッシュが
  // 一覧と同じくらい新しいか」を判定するために渡す（詳細参照）
  const [listFetchedAt, setListFetchedAt] = useState(0)

  // Restore persisted state from localStorage after hydration
  useEffect(() => {
    const savedCollapsed = loadCollapsedState()
    if (savedCollapsed.size > 0) setCollapsedMilestones(savedCollapsed)
    const savedFilters = loadFilterState()
    if (JSON.stringify(savedFilters) !== JSON.stringify(defaultFilters)) setFilters(savedFilters)
  }, [])

  const searchParams = useSearchParams()
  const router = useRouter()
  const isCreateOpen = searchParams.get('create') !== null
  const supabase = useMemo(() => createClient() as SupabaseClient, [])
  const { activeOrgId, loading: orgLoading } = useContext(ActiveOrgContext)

  // 選んだタスクは右側に詳細を出す（ページは移動しない）。URL にも残し、再読み込み・共有で同じ表示に戻せるようにする
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => searchParams.get('task'))
  const selectedTaskIdRef = useRef(selectedTaskId)
  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId
  })

  // タスクを「開いた」時刻。詳細パネルの表示許容誤差(SHOW_TOLERANCE_MS)の基準に使う
  // （詳細は MyTaskInspector の openedAt コメント参照）。イベントハンドラで記録する
  // （レンダー中に Date.now() を呼ばない）。初期表示の `?task=` ディープリンクでは
  // クリックが発生しないため null のままにし、MyTaskInspector 側で listFetchedAt に
  // フォールバックさせる。
  const [openedAt, setOpenedAt] = useState<number | null>(null)

  // `?task=` 付きで開かれた（初期表示から詳細を出す）場合、一覧の読み込みや
  // MyTaskInspector のマウントを待たず、TaskInspector の chunk 先読みを始めておく
  useEffect(() => {
    if (selectedTaskIdRef.current) {
      void import('@/components/task/TaskInspector')
    }
    // マウント時に一度だけ（初期表示のディープリンクのみを対象にするため）
  }, [])

  const selectTask = useCallback((taskId: string | null) => {
    setSelectedTaskId(taskId)
    if (taskId) setOpenedAt(Date.now())
    const params = new URLSearchParams(window.location.search)
    if (taskId) {
      params.set('task', taskId)
    } else {
      params.delete('task')
    }
    const query = params.toString()
    window.history.replaceState(null, '', query ? `/my?${query}` : '/my')
  }, [])

  const handleTaskClick = useCallback((taskId: string) => {
    // 同じタスクをもう一度押したら閉じる
    selectTask(taskId === selectedTaskIdRef.current ? null : taskId)
  }, [selectTask])

  const handleInspectorClose = useCallback(() => selectTask(null), [selectTask])

  const handleInspectorSynced = useCallback((updated: Task, reviewStatus: ReviewStatus | undefined) => {
    setTasks(prev => (prev.includes(updated) ? prev : prev.map(t => (t.id === updated.id ? updated : t))))
    // 詳細側で承認が見つからないときは、一覧の状態を消さない（詳細側の承認の読み込みは失敗しても
    // 黙って空になるため。消すと依頼済みのタスクに「社内承認を依頼」が戻ってしまう）
    if (reviewStatus) {
      setReviewStatuses(prev => (prev[updated.id] === reviewStatus ? prev : { ...prev, [updated.id]: reviewStatus }))
    }
  }, [])

  const handleInspectorDeleted = useCallback((taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId))
    selectTask(null)
  }, [selectTask])

  const selectedTask = useMemo(
    () => (selectedTaskId ? tasks.find(t => t.id === selectedTaskId) ?? null : null),
    [tasks, selectedTaskId]
  )

  // Space options for global create
  const spaceOptions = useMemo(
    () => spaces.map((s) => ({ id: s.id, name: s.name, orgId: s.org_id || '' })),
    [spaces]
  )

  // create=1 の付け外しだけを行い、他のクエリ（選択中タスク task= など）は保持する
  const handleCreateOpen = useCallback(() => {
    const params = new URLSearchParams(window.location.search)
    params.set('create', '1')
    router.push(`/my?${params.toString()}`)
  }, [router])

  const handleCreateClose = useCallback(() => {
    const params = new URLSearchParams(window.location.search)
    params.delete('create')
    const query = params.toString()
    router.push(query ? `/my?${query}` : '/my')
  }, [router])

  const handleCreateSubmit = useCallback(
    async (data: TaskCreateData & { spaceId?: string; orgId?: string }) => {
      const targetSpaceId = data.spaceId
      if (!targetSpaceId) return

      // Validate against known spaces to prevent mismatched spaceId/orgId
      const targetSpace = spaces.find((s) => s.id === targetSpaceId)
      if (!targetSpace) return
      const targetOrgId = targetSpace.org_id || ''
      if (!targetOrgId) return

      try {
        // Get authenticated user
        let uid: string
        const { data: authData, error: authError } = await supabase.auth.getUser()
        if (authError || !authData?.user) {
          const demoUserId = process.env.NEXT_PUBLIC_DEMO_USER_ID
          if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && demoUserId) {
            uid = demoUserId
          } else {
            throw new Error('ログインが必要です')
          }
        } else {
          uid = authData.user.id
        }

        const status = data.type === 'spec' ? 'considering' : 'backlog'

        const myInsertData: Record<string, unknown> = {
            org_id: targetOrgId,
            space_id: targetSpaceId,
            title: data.title,
            description: data.description ?? '',
            status,
            ball: data.ball,
            origin: data.origin,
            type: data.type,
            spec_path: data.type === 'spec' ? data.specPath ?? null : null,
            decision_state: data.type === 'spec' ? data.decisionState ?? null : null,
            client_scope: data.clientScope ?? 'internal',
            start_date: data.startDate ?? null,
            due_date: data.dueDate ?? null,
            assignee_id: data.assigneeId ?? null,
            milestone_id: data.milestoneId ?? null,
            parent_task_id: data.parentTaskId ?? null,
            created_by: uid,
        }
        // wiki_page_id column may not exist yet (migration pending)
        const myWikiPageId = data.type === 'spec' ? data.wikiPageId : undefined
        if (myWikiPageId) {
          myInsertData.wiki_page_id = myWikiPageId
        }

        const { data: created, error: createError } = await (supabase as SupabaseClient)
          .from('tasks')
          .insert(myInsertData)
          .select('*')
          .single()

        if (createError) throw createError

        const createdTask = created as Task

        // Insert task owners
        const ownerRows = [
          ...data.clientOwnerIds.map((ownerId) => ({
            org_id: targetOrgId,
            space_id: targetSpaceId,
            task_id: createdTask.id,
            side: 'client' as const,
            user_id: ownerId,
          })),
          ...data.internalOwnerIds.map((ownerId) => ({
            org_id: targetOrgId,
            space_id: targetSpaceId,
            task_id: createdTask.id,
            side: 'internal' as const,
            user_id: ownerId,
          })),
        ]

        if (ownerRows.length > 0) {
          const { error: ownerError } = await (supabase as SupabaseClient)
            .from('task_owners')
            .insert(ownerRows as Record<string, unknown>[])
          if (ownerError) {
            console.error('Failed to insert task owners:', ownerError)
            // Task created but owners failed - still add to list but warn the user
            toast.warning('タスクは作成しましたが、担当者の設定に失敗しました。担当者を再設定してください。')
          }
        }

        // If the created task is assigned to the current user, add to the list
        if (createdTask.assignee_id === userId || createdTask.assignee_id === DEV_USER_ID) {
          setTasks((prev) => [createdTask, ...prev])
        }
      } catch (err) {
        console.error('Failed to create task:', err)
        toast.error('タスクの作成に失敗しました')
      }
    },
    [supabase, userId, spaces]
  )

  const updateFilters = useCallback((updates: Partial<FilterState>) => {
    setFilters(prev => {
      const next = { ...prev, ...updates }
      saveFilterState(next)
      return next
    })
  }, [])

  const toggleMilestone = useCallback((milestoneKey: string) => {
    setCollapsedMilestones(prev => {
      const next = new Set(prev)
      if (next.has(milestoneKey)) {
        next.delete(milestoneKey)
      } else {
        next.add(milestoneKey)
      }
      saveCollapsedState(next)
      return next
    })
  }, [])

  const queryClient = useQueryClient()
  // tasks を直接依存に入れると一覧の変更のたびに作り直され、TaskRow の memo を素通りしてしまう
  // ため、直前の状態は tasksRef 経由で読む（onStatusChange は安定した参照のまま渡せる）
  const updateTaskStatus = useCallback(async (taskId: string, status: TaskStatus) => {
    const prevStatus = tasksRef.current.find(t => t.id === taskId)?.status

    // Optimistic update
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status } : t))

    const { error } = await (supabase as SupabaseClient)
      .from('tasks')
      .update({ status })
      .eq('id', taskId)

    if (error) {
      // Revert on error
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: prevStatus ?? t.status } : t))
      console.error('Failed to update task status:', error)
      return
    }

    // 右側の詳細（プロジェクト単位の読み込み結果）のキャッシュも合わせる。ネットワークは
    // 発行しない — invalidateQueries はプロジェクト全体を丸ごと読み直す重い操作になるため、
    // 該当タスクだけをキャッシュ上で書き換える
    const target = tasksRef.current.find(t => t.id === taskId)
    if (target) {
      const key = ['tasks', target.org_id, target.space_id] as const
      // setQueryData は既定で dataUpdatedAt を「今」に更新してしまう。ここでは一覧の行だけを
      // 直接いじっているのであって、そのプロジェクトを丸ごと読み直したわけではないので、
      // 更新時刻はそのまま据え置く（更新したことにすると、1日前の永続キャッシュが
      // 「今取れたばかり」に見えてしまい、詳細パネル側の新旧判定が壊れる）
      queryClient.setQueryData<TasksQueryData>(
        key,
        (old) => (old ? { ...old, tasks: old.tasks.map(t => (t.id === taskId ? { ...t, status } : t)) } : old),
        { updatedAt: queryClient.getQueryState(key)?.dataUpdatedAt }
      )
    }
  }, [supabase, queryClient])

  useEffect(() => {
    // org解決前はフェッチしない（cross-org leak防止）
    if (orgLoading) return

    async function fetchData(uid: string) {
      setUserId(uid)
      // クエリ発行の直前に記録。MyTaskInspector 側で useTasks のキャッシュ(プロジェクト単位)が
      // この一覧取得より新しいかどうかを判定するのに使う
      const fetchStartedAt = Date.now()

      // 社内承認の状態（reviews）も同じ1回の取得で読む（別に取りに行くと待ちが直列になる）
      let tasksQuery = supabase
        .from('tasks')
        .select('*, reviews(status, created_at)')
        .eq('assignee_id', uid)

      let spacesQuery = supabase
        .from('spaces')
        .select('*')

      let milestonesQuery = supabase
        .from('milestones')
        .select('*')
        .order('due_date', { ascending: true, nullsFirst: false })

      if (activeOrgId) {
        tasksQuery = tasksQuery.eq('org_id', activeOrgId)
        spacesQuery = spacesQuery.eq('org_id', activeOrgId)
        milestonesQuery = milestonesQuery.eq('org_id', activeOrgId)
      }

      // 想定外の形のデータや通信の失敗で落ちても、「読み込み中」のまま止めない
      try {
        const [tasksRes, spacesRes, milestonesRes] = await Promise.all([
          tasksQuery,
          spacesQuery,
          milestonesQuery,
        ])

        if (tasksRes.error) {
          setError(new Error('タスクの取得に失敗しました'))
        } else {
          const { tasks: fetchedTasks, reviewStatuses: fetchedReviewStatuses } = splitEmbeddedReviews(
            (tasksRes.data || []) as Array<Task & { reviews?: EmbeddedReviews }>
          )
          setTasks(fetchedTasks)
          setReviewStatuses(fetchedReviewStatuses)
          setSpaces(spacesRes.data || [])
          setMilestones(milestonesRes.data || [])
          setListFetchedAt(fetchStartedAt)
        }
      } catch (err) {
        console.error('Failed to load my tasks:', err)
        setError(new Error('タスクの取得に失敗しました'))
      } finally {
        setLoading(false)
      }
    }

    async function initAuth() {
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        await fetchData(user.id)
      } else {
        if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
          console.log('[MyTasks] Development mode: using demo user')
          await fetchData(DEV_USER_ID)
        } else {
          setError(new Error('ログインが必要です'))
          setLoading(false)
        }
      }
    }

    initAuth()
  }, [supabase, activeOrgId, orgLoading, retryKey])

  const handleRetry = useCallback(() => {
    setError(null)
    setLoading(true)
    setRetryKey((k) => k + 1)
  }, [])

  // Filter and sort tasks
  const filteredTasks = useMemo(() => {
    let result = [...tasks]

    // Status filter
    if (filters.status !== 'all') {
      result = result.filter(t => t.status === filters.status)
    } else if (!filters.showCompleted) {
      result = result.filter(t => t.status !== 'done' && t.status !== 'backlog')
    }

    // Space filter
    if (filters.spaceId) {
      result = result.filter(t => t.space_id === filters.spaceId)
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0
      switch (filters.sortField) {
        case 'due_date':
          const aDate = a.due_date || '9999-12-31'
          const bDate = b.due_date || '9999-12-31'
          comparison = aDate.localeCompare(bDate)
          break
        case 'created_at':
          comparison = a.created_at.localeCompare(b.created_at)
          break
        case 'priority':
          comparison = (a.priority || 0) - (b.priority || 0)
          break
        case 'title':
          comparison = a.title.localeCompare(b.title)
          break
      }
      return filters.sortOrder === 'asc' ? comparison : -comparison
    })

    return result
  }, [tasks, filters])

  // Group tasks by space, then by milestone
  const taskGroups = useMemo(() => {
    const activeTasks = filteredTasks.filter(t => t.status !== 'done' && t.status !== 'backlog')

    const spaceMap = new Map<string, Task[]>()
    activeTasks.forEach(task => {
      const spaceId = task.space_id || 'no-space'
      if (!spaceMap.has(spaceId)) {
        spaceMap.set(spaceId, [])
      }
      spaceMap.get(spaceId)!.push(task)
    })

    const groups: TaskGroup[] = []

    spaceMap.forEach((spaceTasks, spaceId) => {
      const space = spaces.find(s => s.id === spaceId) || null

      const milestoneMap = new Map<string, Task[]>()
      spaceTasks.forEach(task => {
        const milestoneId = task.milestone_id || 'no-milestone'
        if (!milestoneMap.has(milestoneId)) {
          milestoneMap.set(milestoneId, [])
        }
        milestoneMap.get(milestoneId)!.push(task)
      })

      const milestoneGroups = Array.from(milestoneMap.entries()).map(([milestoneId, mTasks]) => ({
        milestone: milestones.find(m => m.id === milestoneId) || null,
        tasks: mTasks
      }))

      milestoneGroups.sort((a, b) => {
        if (!a.milestone && !b.milestone) return 0
        if (!a.milestone) return 1
        if (!b.milestone) return -1
        const aDate = a.milestone.due_date || ''
        const bDate = b.milestone.due_date || ''
        return aDate.localeCompare(bDate)
      })

      groups.push({ space, milestoneGroups })
    })

    groups.sort((a, b) => {
      const aName = a.space?.name || ''
      const bName = b.space?.name || ''
      return aName.localeCompare(bName)
    })

    return groups
  }, [filteredTasks, spaces, milestones])

  const completedTasks = filteredTasks.filter(t => t.status === 'done')
  const activeTasks = filteredTasks.filter(t => t.status !== 'done' && t.status !== 'backlog')

  const hasActiveFilters = filters.status !== 'all' || filters.spaceId !== null || filters.showCompleted

  function formatDate(dateStr: string | null): string | null {
    if (!dateStr) return null
    const date = new Date(dateStr)
    const month = date.getMonth() + 1
    const day = date.getDate()
    return `${month}/${day}`
  }

  function getMilestoneKey(spaceId: string | undefined, milestoneId: string | undefined): string {
    return `${spaceId || 'no-space'}:${milestoneId || 'no-milestone'}`
  }

  function resetFilters() {
    updateFilters(defaultFilters)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <header className="h-12 border-b border-gray-100 flex items-center px-5 flex-shrink-0">
        <h1 className="text-sm font-medium text-gray-900 flex items-center gap-2">
          <Target className="text-lg text-gray-500" />
          マイタスク
        </h1>
        <span className="ml-2 text-xs text-gray-400">
          {activeTasks.length}件
        </span>

        <div className="flex-1" />

        {/* Create button */}
        <button
          onClick={handleCreateOpen}
          data-testid="my-tasks-create"
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded transition-colors mr-1"
          title="新規タスク"
        >
          <Plus weight="bold" className="text-sm" />
          作成
        </button>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded transition-colors ${
            showFilters || hasActiveFilters
              ? 'bg-blue-50 text-blue-700'
              : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          <FunnelSimple weight={hasActiveFilters ? 'fill' : 'regular'} className="text-sm" />
          フィルター
          {hasActiveFilters && (
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
          )}
        </button>

        {/* Sort button */}
        <button
          onClick={() => updateFilters({ sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc' })}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded transition-colors ml-1"
        >
          {filters.sortOrder === 'asc' ? (
            <SortAscending className="text-sm" />
          ) : (
            <SortDescending className="text-sm" />
          )}
          {sortLabels[filters.sortField]}
        </button>
        {/* お知らせベル。ヘッダーの一番右に置く。この目印(data-header-bell)があると、
            AppShell がページ上部に出す「ベルだけの1行」が globals.css の :has() で消える。
            モバイルは AppShell のヘッダーにベルがあるので md 未満では出さない。 */}
        <div data-header-bell className="hidden md:block ml-1">
          <AnnouncementBell />
        </div>
      </header>

      {/* Filter bar */}
      {showFilters && (
        <div className="border-b border-gray-100 px-5 py-3 bg-gray-50/50 flex items-center gap-4 flex-wrap">
          {/* Status filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">ステータス:</span>
            <select
              value={filters.status}
              onChange={(e) => updateFilters({ status: e.target.value as StatusFilter })}
              className="text-xs border border-gray-200 rounded px-2 py-1 bg-surface focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Space filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">プロジェクト:</span>
            <select
              value={filters.spaceId || ''}
              onChange={(e) => updateFilters({ spaceId: e.target.value || null })}
              className="text-xs border border-gray-200 rounded px-2 py-1 bg-surface focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">すべて</option>
              {spaces.map(space => (
                <option key={space.id} value={space.id}>{space.name}</option>
              ))}
            </select>
          </div>

          {/* Sort field */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">並び替え:</span>
            <select
              value={filters.sortField}
              onChange={(e) => updateFilters({ sortField: e.target.value as SortField })}
              className="text-xs border border-gray-200 rounded px-2 py-1 bg-surface focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {Object.entries(sortLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Show completed toggle */}
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.showCompleted}
              onChange={(e) => updateFilters({ showCompleted: e.target.checked })}
              className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
            />
            完了を表示
          </label>

          {/* Reset button */}
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 ml-auto"
            >
              <X className="text-sm" />
              リセット
            </button>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="py-4">
          {loading && <LoadingState />}
          {error && <ErrorRetry message={error.message} onRetry={handleRetry} />}
          {!loading && !error && tasks.length === 0 && (
            <EmptyState
              icon={<Target />}
              message="担当者に設定されたタスクがここに表示されます。タスクの担当者欄から自分を設定してみましょう。"
            />
          )}
          {!loading && !error && tasks.length > 0 && filteredTasks.length === 0 && (
            <EmptyState
              icon={<FunnelSimple />}
              message="条件に一致するタスクがありません"
              action={
                <button
                  onClick={resetFilters}
                  className="text-xs text-blue-500 hover:underline"
                >
                  フィルターをリセット
                </button>
              }
            />
          )}
          {!loading && !error && filteredTasks.length > 0 && (
            <div className="space-y-6">
              {/* Active tasks grouped by project and milestone */}
              {taskGroups.map((group, groupIndex) => (
                <div key={group.space?.id || `no-space-${groupIndex}`}>
                  {/* Project header - Level 0 */}
                  <div className="flex items-center gap-1.5 px-2 py-2 bg-gray-100 rounded-sm">
                    <Folder weight="fill" className="text-gray-500 text-sm" />
                    <span className="text-[13px] font-bold text-gray-800">
                      {group.space?.name || 'プロジェクト未設定'}
                    </span>
                    <span className="text-xs text-gray-500 tabular-nums">
                      {group.milestoneGroups.reduce((acc, mg) => acc + mg.tasks.length, 0)}件
                    </span>
                  </div>

                  {/* Milestone groups within project - Level 1 (indented) */}
                  <div className="space-y-3 py-2">
                    {group.milestoneGroups.map((mg, mgIndex) => {
                      const milestoneKey = getMilestoneKey(group.space?.id, mg.milestone?.id)
                      const isCollapsed = collapsedMilestones.has(milestoneKey)

                      return (
                        <div key={mg.milestone?.id || `no-milestone-${mgIndex}`}>
                          {/* Milestone header - slight indent */}
                          <div
                            className="flex items-center gap-1.5 pl-4 pr-2 py-1.5 bg-gray-50 rounded cursor-pointer hover:bg-gray-100 transition-colors select-none mx-2"
                            onClick={() => toggleMilestone(milestoneKey)}
                          >
                            <div className="w-3 flex justify-center text-gray-400">
                              {isCollapsed ? (
                                <CaretRight weight="bold" className="text-[10px]" />
                              ) : (
                                <CaretDown weight="bold" className="text-[10px]" />
                              )}
                            </div>
                            <span className="text-[13px] font-semibold text-gray-700">
                              {mg.milestone?.name || 'マイルストーン未設定'}
                            </span>
                            {mg.milestone?.due_date && (
                              <span className="text-xs text-gray-400 tabular-nums">
                                {formatDate(mg.milestone.due_date)}
                              </span>
                            )}
                            <span className="text-xs text-gray-400 tabular-nums">
                              ({mg.tasks.length})
                            </span>
                          </div>

                          {/* Tasks in this milestone - Level 2 */}
                          {!isCollapsed && (
                            <div className="pl-3 mt-1">
                              {mg.tasks.map((task) => (
                                <TaskRow
                                  key={task.id}
                                  task={task}
                                  isSelected={task.id === selectedTaskId}
                                  onClick={handleTaskClick}
                                  onStatusChange={updateTaskStatus}
                                  reviewStatus={reviewStatuses[task.id]}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}

              {/* Completed tasks */}
              {filters.showCompleted && completedTasks.length > 0 && (
                <div className="mt-6">
                  <div className="flex items-center gap-2 px-4 py-2 border-t border-gray-200">
                    <span className="text-xs font-semibold text-gray-400">
                      完了 ({completedTasks.length})
                    </span>
                  </div>
                  <div className="opacity-50">
                    {completedTasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        isSelected={task.id === selectedTaskId}
                        onClick={handleTaskClick}
                        onStatusChange={updateTaskStatus}
                        reviewStatus={reviewStatuses[task.id]}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Task Create Sheet (global create with space selector) */}
      <TaskCreateSheet
        spaceId=""
        isOpen={isCreateOpen}
        onClose={handleCreateClose}
        onSubmit={handleCreateSubmit}
        spaces={spaceOptions}
      />

      {selectedTask && (
        <MyTaskInspector
          key={selectedTask.id}
          task={selectedTask}
          // クリックで開いた場合は openedAt（イベント時刻）、初期表示の `?task=` ディープ
          // リンクでは openedAt がまだ無いので listFetchedAt を代わりに使う
          openedAt={openedAt ?? listFetchedAt}
          listFetchedAt={listFetchedAt}
          onClose={handleInspectorClose}
          onSynced={handleInspectorSynced}
          onDeleted={handleInspectorDeleted}
        />
      )}
    </div>
  )
}
