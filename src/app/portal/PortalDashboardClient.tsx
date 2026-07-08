'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, Warning, Plus } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  PortalShell,
  PortalTaskInspector,
  PortalOnboardingWalkthrough,
  ActionSection,
  ProgressSection,
  MilestoneTimeline,
  ActivityFeed,
  type HealthStatus,
  type MilestoneStatus,
} from '@/components/portal'
import { PortalRequestSheet } from '@/components/portal/PortalRequestSheet'
import { BentoCard } from '@/components/portal/dashboard/BentoCard'
import { MetricCard } from '@/components/portal/dashboard/MetricCard'
import { BallOwnershipRadar } from '@/components/portal/dashboard/BallOwnershipRadar'
import { ApprovalHistory } from '@/components/portal/dashboard/ApprovalHistory'
import { NextDeliveryMetric } from '@/components/portal/dashboard/NextDeliveryMetric'

interface Project {
  id: string
  name: string
  orgId: string
  orgName?: string
}

interface Comment {
  id: string
  content: string
  createdAt: string
  author?: {
    name: string
    isClient?: boolean
  }
}

interface Task {
  id: string
  title: string
  description?: string | null
  dueDate?: string | null
  isOverdue?: boolean
  waitingDays?: number
  type?: 'task' | 'spec'
  status?: string
  createdAt?: string
  comments?: Comment[]
  estimatedCost?: number | null
  estimateStatus?: 'none' | 'pending' | 'approved' | 'rejected'
}

interface Milestone {
  id: string
  name: string
  status: MilestoneStatus
  dueDate?: string | null
}

interface Activity {
  id: string
  type: 'task_completed' | 'comment' | 'milestone' | 'notification'
  message: string
  timestamp: string
  actor?: string
  /** Task the activity is about, if any — renders the item as a link to /portal/task/[taskId] (B-3). */
  taskId?: string
}

interface Approval {
  id: string
  taskTitle: string
  approvedAt: string
  comment?: string
}

interface DashboardData {
  health: {
    status: HealthStatus
    reason: string
    nextMilestone?: {
      name: string
      date: string | null
      overdueDays?: number
    }
  }
  alert: {
    overdueCount: number
    nextDueDate: string | null
  }
  actionTasks: Task[]
  totalActionCount: number
  waitingMessage?: string
  progress: {
    completedCount: number
    totalCount: number
    deadline?: string | null
  }
  milestones: Milestone[]
  ballOwnership: {
    clientCount: number
    teamCount: number
  }
  currentPhaseProgress: {
    completedCount: number
    totalCount: number
    phaseName: string
  }
  activities: Activity[]
  approvals: Approval[]
}

interface PortalDashboardClientProps {
  currentProject: Project
  projects: Project[]
  dashboardData: DashboardData
  /** Internal-facing read-only preview (`/portal/preview/[spaceId]`): disables all write actions. */
  previewMode?: boolean
}

export function PortalDashboardClient({
  currentProject,
  projects,
  dashboardData,
  previewMode = false,
}: PortalDashboardClientProps) {
  const router = useRouter()
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [requestSheetOpen, setRequestSheetOpen] = useState(false)
  const [submittingTaskId, setSubmittingTaskId] = useState<string | null>(null)

  // Keep in-page links pointed at the currently selected project (S6) — only
  // needed once there is more than one, to leave the common case untouched.
  const spaceQuery = projects.length > 1 ? `?space=${currentProject.id}` : ''

  const handleApprove = async (taskId: string, comment: string) => {
    if (previewMode || submittingTaskId === taskId) return
    setSubmittingTaskId(taskId)
    try {
      const response = await fetch(`/api/portal/tasks/${taskId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', comment }),
      })

      if (!response.ok) {
        let errorData: { error?: string } = {}
        try {
          errorData = await response.json()
        } catch {
          // JSON parse failed
        }
        console.error('Approve error:', { status: response.status, ...errorData })

        if (response.status === 409) {
          toast.error('他のユーザーが先に操作しました。画面を更新します。')
          router.refresh()
        } else if (response.status === 403) {
          toast.error('このタスクにはアクセスできません。')
        } else if (response.status === 401) {
          toast.error('セッションが切れました。再度アクセスしてください。')
          router.push('/login')
        } else {
          toast.error('操作に失敗しました。しばらくしてからお試しください。')
        }
        return
      }

      toast.success('承認しました。チームに通知されます。')
      setSelectedTask(null)
      router.refresh()
    } catch (error) {
      console.error('Approve failed:', error)
      toast.error('ネットワークエラーが発生しました。しばらくしてからお試しください。')
    } finally {
      setSubmittingTaskId(null)
    }
  }

  const handleRequestChanges = async (taskId: string, comment: string) => {
    if (previewMode || submittingTaskId === taskId) return
    setSubmittingTaskId(taskId)
    try {
      const response = await fetch(`/api/portal/tasks/${taskId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request_changes', comment }),
      })

      if (!response.ok) {
        const error = await response.json()
        console.error('Request changes error:', error)
        if (response.status === 409) {
          toast.error('他のユーザーが先に操作しました。画面を更新します。')
          router.refresh()
        } else if (response.status === 400) {
          toast.error(error.error || 'コメントを入力してください。')
        }
        return
      }

      setSelectedTask(null)
      router.refresh()
    } catch (error) {
      console.error('Request changes failed:', error)
      toast.error('操作に失敗しました。しばらくしてからお試しください。')
    } finally {
      setSubmittingTaskId(null)
    }
  }

  const handleEstimateApprove = async (taskId: string, comment: string) => {
    if (previewMode || submittingTaskId === taskId) return
    setSubmittingTaskId(taskId)
    try {
      const response = await fetch(`/api/portal/tasks/${taskId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'estimate_approve', comment }),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        toast.error(errorData.error || '操作に失敗しました。しばらくしてからお試しください。')
        if (response.status === 409) router.refresh()
        return
      }
      setSelectedTask(null)
      router.refresh()
    } catch (error) {
      console.error('Estimate approve failed:', error)
      toast.error('ネットワークエラーが発生しました。しばらくしてからお試しください。')
    } finally {
      setSubmittingTaskId(null)
    }
  }

  const handleEstimateReject = async (taskId: string, comment: string) => {
    if (previewMode || submittingTaskId === taskId) return
    setSubmittingTaskId(taskId)
    try {
      const response = await fetch(`/api/portal/tasks/${taskId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'estimate_reject', comment }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        toast.error(error.error || '操作に失敗しました。しばらくしてからお試しください。')
        if (response.status === 409) router.refresh()
        return
      }
      setSelectedTask(null)
      router.refresh()
    } catch (error) {
      console.error('Estimate reject failed:', error)
      toast.error('ネットワークエラーが発生しました。しばらくしてからお試しください。')
    } finally {
      setSubmittingTaskId(null)
    }
  }

  const handleViewDetail = (taskId: string) => {
    // Toggle: if same task is clicked, close inspector
    if (selectedTask?.id === taskId) {
      setSelectedTask(null)
      return
    }

    const task = dashboardData.actionTasks.find(t => t.id === taskId)
    if (task) {
      // Add status for inspector
      setSelectedTask({ ...task, status: 'considering' })
    }
  }

  // Inspector content
  const inspector = selectedTask ? (
    <PortalTaskInspector
      task={selectedTask}
      onClose={() => setSelectedTask(null)}
      onApprove={handleApprove}
      onRequestChanges={handleRequestChanges}
      onEstimateApprove={handleEstimateApprove}
      onEstimateReject={handleEstimateReject}
      readOnly={previewMode}
    />
  ) : null

  // 「クライアント表示プレビュー」バナー — amber-500 = クライアント可視の意味に合わせ、
  // このダッシュボードがクライアントに見える内容そのものであることを示す。
  const previewBanner = previewMode ? (
    <div className="flex-shrink-0 flex items-center justify-between gap-4 px-4 py-2 bg-amber-500 text-white text-sm font-medium">
      <span>クライアント表示プレビュー — クライアントにはこのように表示されます</span>
      <Link
        href={`/${currentProject.orgId}/project/${currentProject.id}`}
        className="underline hover:no-underline whitespace-nowrap flex-shrink-0"
      >
        プロジェクトに戻る
      </Link>
    </div>
  ) : null

  return (
    <PortalShell
      currentProject={currentProject}
      projects={projects}
      actionCount={dashboardData.totalActionCount}
      inspector={inspector}
      banner={previewBanner}
    >
      {/* Onboarding walkthrough - shown only on first visit (skipped in preview: this is an internal viewer, not the client) */}
      {!previewMode && <PortalOnboardingWalkthrough />}

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto space-y-8">

          {/* Welcome / Header */}
          <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">
                プロジェクトダッシュボード
              </h1>
              <p className="mt-2 text-gray-600 max-w-2xl">
                プロジェクトの全体進捗と、あなたの確認が必要な項目です。
              </p>
              {/* ボールの所在: あなた(client) / 先方(team) — 「今どちらの番か」を明示 */}
              {dashboardData.ballOwnership.clientCount + dashboardData.ballOwnership.teamCount > 0 && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-gray-400">ボールの所在</span>
                  <BallOwnershipRadar
                    clientCount={dashboardData.ballOwnership.clientCount}
                    teamCount={dashboardData.ballOwnership.teamCount}
                  />
                </div>
              )}
            </div>
            <button
              type="button"
              data-testid="portal-dashboard-request-button"
              onClick={() => !previewMode && setRequestSheetOpen(true)}
              disabled={previewMode}
              title={previewMode ? 'プレビューでは操作できません' : undefined}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700 shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-indigo-600"
            >
              <Plus className="text-lg" weight="bold" />
              リクエストを送る
            </button>
          </div>

          {/* BENTO GRID LAYOUT */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

            {/* 1. PROGRESS RING (2x2) - The Positive Anchor */}
            <div className="lg:col-span-1 lg:row-span-2 md:col-span-2">
              <ProgressSection
                completedCount={dashboardData.progress.completedCount}
                totalCount={dashboardData.progress.totalCount}
                deadline={dashboardData.progress.deadline}
                className="h-full"
              />
            </div>

            {/* 2. KEY METRICS ROW (3 cards) */}

            {/* 現在のステータス (左) */}
            <MetricCard
              label="現在のステータス"
              status={dashboardData.health.status}
              value={
                <span className={`text-xl ${dashboardData.health.status === 'on_track' ? 'text-emerald-600' :
                    dashboardData.health.status === 'at_risk' ? 'text-amber-600' : 'text-rose-600'
                  }`}>
                  {dashboardData.health.status === 'on_track' ? '順調に進行中' :
                    dashboardData.health.status === 'at_risk' ? '注意が必要' : '要対応'}
                </span>
              }
              trend={{
                text: dashboardData.health.reason
              }}
              icon={
                dashboardData.health.status === 'on_track' ? <CheckCircle weight="duotone" className="text-emerald-500" /> :
                  <Warning weight="duotone" className={dashboardData.health.status === 'at_risk' ? 'text-amber-500' : 'text-rose-500'} />
              }
            />

            {/* 次回納品予定 (中央) - 期限超過時に赤表示 */}
            <NextDeliveryMetric
              milestoneName={dashboardData.health.nextMilestone?.name}
              dueDate={dashboardData.health.nextMilestone?.date ?? null}
              overdueDays={dashboardData.health.nextMilestone?.overdueDays || 0}
            />

            {/* ご依頼の進捗 (右) - 現在フェーズの完了数/全数 */}
            {(() => {
              const { completedCount: phaseCompleted, totalCount: phaseTotal, phaseName } = dashboardData.currentPhaseProgress
              const hasPhase = phaseTotal > 0

              return (
                <MetricCard
                  label="ご依頼の進捗"
                  status={hasPhase && phaseCompleted === phaseTotal ? 'on_track' : 'default'}
                  value={
                    hasPhase ? (
                      <span className="text-gray-900">
                        {phaseCompleted}
                        <span className="text-base text-gray-400 font-medium ml-0.5">/ {phaseTotal}件が完了</span>
                      </span>
                    ) : (
                      <span className="text-gray-500">フェーズ未設定</span>
                    )
                  }
                  trend={{
                    text: hasPhase
                      ? phaseName
                      : 'マイルストーンが設定されていません'
                  }}
                  icon={<CheckCircle weight="duotone" className={hasPhase && phaseCompleted === phaseTotal ? 'text-emerald-500' : 'text-indigo-400'} />}
                />
              )
            })()}

            {/* 3. PRIMARY ACTION LIST (spans 3 cols) */}
            <div className="lg:col-span-3 lg:row-span-2 md:col-span-2">
              <BentoCard
                title={
                  <span className="flex items-center gap-2">
                    確認待ちのタスク
                    <span className={`inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium rounded-full ${
                      dashboardData.totalActionCount > 0
                        ? 'text-white bg-amber-500'
                        : 'text-gray-500 bg-gray-100'
                    }`}>
                      {dashboardData.totalActionCount}件
                    </span>
                    <span className="text-xs text-gray-400 font-normal">
                      / 全{dashboardData.progress.totalCount}件
                    </span>
                  </span>
                }
                className="h-full min-h-[400px]"
                action={
                  dashboardData.totalActionCount > 6 && (
                    <Link href={`/portal/tasks${spaceQuery}`} className="text-xs text-indigo-600 hover:underline">
                      すべて見る &rarr;
                    </Link>
                  )
                }
              >
                <ActionSection
                  tasks={dashboardData.actionTasks}
                  totalCount={dashboardData.totalActionCount}
                  waitingMessage={dashboardData.waitingMessage}
                  selectedTaskId={selectedTask?.id}
                  onApprove={handleApprove}
                  onRequestChanges={handleRequestChanges}
                  onViewDetail={handleViewDetail}
                  maxDisplay={6}
                  readOnly={previewMode}
                />
              </BentoCard>
            </div>

            {/* 4. ACTIVITY FEED (under Progress) */}
            <div className="lg:col-span-1 md:col-span-2">
              <BentoCard
                title="最近のアクティビティ"
                className="h-full max-h-[350px]"
              >
                <div className="max-h-[250px] overflow-y-auto pr-2 -mr-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
                  {dashboardData.activities.length > 0 ? (
                    <ActivityFeed activities={dashboardData.activities} />
                  ) : (
                    <p className="text-sm text-gray-400 italic text-center py-4">アクティビティはありません</p>
                  )}
                </div>
              </BentoCard>
            </div>

            {/* 5. MILESTONE TIMELINE (Full width) */}
            <div className="lg:col-span-4 md:col-span-2">
              <BentoCard title="スケジュールと進捗" className="h-full">
                <div className="py-2">
                  <MilestoneTimeline milestones={dashboardData.milestones} />
                </div>
              </BentoCard>
            </div>

            {/* 6. 承認履歴 (Full width) — 承認済みの記録で「言った言わない」を防ぐ信頼シグナル */}
            {dashboardData.approvals.length > 0 && (
              <div className="lg:col-span-4 md:col-span-2">
                <ApprovalHistory approvals={dashboardData.approvals} />
              </div>
            )}

          </div>

        </div>
      </div>
      <PortalRequestSheet
        isOpen={requestSheetOpen}
        onClose={() => setRequestSheetOpen(false)}
        onSuccess={() => router.refresh()}
      />
    </PortalShell>
  )
}
