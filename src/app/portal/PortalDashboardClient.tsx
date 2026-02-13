'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, Warning, Clock } from '@phosphor-icons/react'
import {
  PortalShell,
  PortalTaskInspector,
  ActionSection,
  ProgressSection,
  MilestoneTimeline,
  ActivityFeed,
  type HealthStatus,
  type MilestoneStatus,
} from '@/components/portal'
import { BentoCard } from '@/components/portal/dashboard/BentoCard'
import { MetricCard } from '@/components/portal/dashboard/MetricCard'

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
      date: string
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
  activities: Activity[]
  approvals: Approval[]
}

interface PortalDashboardClientProps {
  currentProject: Project
  projects: Project[]
  dashboardData: DashboardData
}

export function PortalDashboardClient({
  currentProject,
  projects,
  dashboardData,
}: PortalDashboardClientProps) {
  const router = useRouter()
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  const handleApprove = async (taskId: string, comment: string) => {
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

        const errorMessage = errorData.error || 'エラーが発生しました'
        if (response.status === 409) {
          alert(errorMessage)
          router.refresh()
        } else if (response.status === 403) {
          alert('このタスクへのアクセス権限がありません')
        } else if (response.status === 401) {
          alert('セッションが切れました。再ログインしてください。')
          router.push('/login')
        } else {
          alert(errorMessage)
        }
        return
      }

      setSelectedTask(null)
      router.refresh()
    } catch (error) {
      console.error('Approve failed:', error)
      alert('ネットワークエラーが発生しました')
    }
  }

  const handleRequestChanges = async (taskId: string, comment: string) => {
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
          alert('タスクの状態が変更されました。ページを再読み込みしてください。')
          router.refresh()
        } else if (response.status === 400 && error.error?.includes('Comment')) {
          alert('コメントを入力してください。')
        }
        return
      }

      setSelectedTask(null)
      router.refresh()
    } catch (error) {
      console.error('Request changes failed:', error)
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
    />
  ) : null

  return (
    <PortalShell
      currentProject={currentProject}
      projects={projects}
      actionCount={dashboardData.totalActionCount}
      inspector={inspector}
    >
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto space-y-8">

          {/* Welcome / Header */}
          <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
                プロジェクトダッシュボード
              </h1>
              <p className="mt-2 text-gray-600 font-medium max-w-2xl">
                プロジェクトの全体進捗と、あなたの確認が必要な項目です。
              </p>
            </div>
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

            {/* Health Status */}
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

            {/* Next Delivery */}
            <MetricCard
              label="次回納品予定"
              value={dashboardData.health.nextMilestone?.date ? new Date(dashboardData.health.nextMilestone.date).toLocaleDateString('ja-JP') : '未定'}
              trend={{
                text: dashboardData.health.nextMilestone?.name || 'フェーズ未定'
              }}
              icon={<Clock weight="duotone" />}
            />

            {/* Action Required - What client needs to do */}
            <MetricCard
              label="要アクション"
              status={dashboardData.alert.overdueCount > 0 ? 'needs_attention' : dashboardData.totalActionCount > 0 ? 'at_risk' : 'on_track'}
              value={
                dashboardData.alert.overdueCount > 0 ? (
                  <span className="text-rose-600">{dashboardData.alert.overdueCount}件が期限超過</span>
                ) : dashboardData.totalActionCount > 0 ? (
                  <span className="text-amber-600">{dashboardData.totalActionCount}件の確認待ち</span>
                ) : (
                  <span className="text-emerald-600">対応完了！</span>
                )
              }
              trend={{
                text: dashboardData.alert.overdueCount > 0
                  ? '対応いただくと遅延が解消します'
                  : dashboardData.totalActionCount > 0
                    ? `次の期限: ${dashboardData.alert.nextDueDate ? new Date(dashboardData.alert.nextDueDate).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) : '未定'}`
                    : '現在確認待ちはありません'
              }}
              icon={
                dashboardData.alert.overdueCount > 0 ? <Warning weight="duotone" className="text-rose-500" /> :
                dashboardData.totalActionCount > 0 ? <Clock weight="duotone" className="text-amber-500" /> :
                <CheckCircle weight="duotone" className="text-emerald-500" />
              }
            />

            {/* 3. PRIMARY ACTION LIST (spans 3 cols) */}
            <div className="lg:col-span-3 lg:row-span-2 md:col-span-2">
              <BentoCard
                title={
                  <span className="flex items-center gap-2">
                    確認待ちのタスク
                    {dashboardData.totalActionCount > 0 && (
                      <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold text-white bg-amber-500 rounded-full">
                        {dashboardData.totalActionCount}件
                      </span>
                    )}
                    <span className="text-xs text-gray-400 font-normal">
                      / 全{dashboardData.progress.totalCount}件
                    </span>
                  </span>
                }
                className="h-full min-h-[400px]"
                action={
                  dashboardData.totalActionCount > 6 && (
                    <Link href="/portal/tasks" className="text-xs text-indigo-600 hover:underline">
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

          </div>

        </div>
      </div>
    </PortalShell>
  )
}
