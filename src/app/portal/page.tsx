import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

// AT-010: Client dashboard prioritizes ball=client tasks
// - ball=client tasks appear first (considering, pending review)
// - Sorted by due_date ASC (null last)
// - ball=internal is excluded from client priority view

interface PortalTask {
  id: string
  title: string
  status: string
  ball: 'client' | 'internal'
  due_date: string | null
  priority: string | null
  type: string
  decision_state: string | null
  created_at: string
}

export default async function PortalDashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // クライアントの最初のスペースを取得
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membership } = await (supabase as any)
    .from('space_memberships')
    .select(`
      space_id,
      spaces!inner (
        id,
        name,
        org_id
      )
    `)
    .eq('user_id', user.id)
    .eq('role', 'client')
    .limit(1)
    .single()

  if (!membership) {
    // クライアントとしてのスペースがない場合
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">アクセス権限がありません</h1>
          <p className="text-gray-600">招待リンクからアクセスしてください</p>
        </div>
      </div>
    )
  }

  const spaceId = membership.space_id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spaceName = (membership.spaces as any)?.name || 'プロジェクト'

  // AT-010: Fetch tasks with ball=client prioritization
  // Priority order: considering/undecided first, then by due_date (null last)

  // 1. ball=client + considering (HIGHEST priority - needs client decision)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: consideringTasks } = await (supabase as any)
    .from('tasks')
    .select('id, title, status, ball, due_date, type, decision_state')
    .eq('space_id', spaceId)
    .eq('ball', 'client')
    .eq('status', 'considering')
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  // 2. ball=client + other active statuses (still needs attention)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: otherClientTasks } = await (supabase as any)
    .from('tasks')
    .select('id, title, status, ball, due_date, type, decision_state')
    .eq('space_id', spaceId)
    .eq('ball', 'client')
    .in('status', ['open', 'in_progress'])
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  // 3. ball=internal tasks (minimal info for visibility only)
  // Only show title and status - no sensitive fields including due_date
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: internalTasks } = await (supabase as any)
    .from('tasks')
    .select('id, title, status') // Minimal fields only - title/status
    .eq('space_id', spaceId)
    .eq('ball', 'internal')
    .in('status', ['open', 'in_progress'])
    .order('created_at', { ascending: false }) // Order by created_at instead
    .limit(5) // Further limited

  // 3. Completed tasks (for stats)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: completedTasks, count: completedCount } = await (supabase as any)
    .from('tasks')
    .select('id', { count: 'exact' })
    .eq('space_id', spaceId)
    .eq('status', 'done')

  // Combine tasks with AT-010 ordering: considering first, then other client tasks
  const priorityTasks: PortalTask[] = consideringTasks || []
  const otherTasks: PortalTask[] = otherClientTasks || []
  const allClientTasks: PortalTask[] = [...priorityTasks, ...otherTasks]
  const allInternalTasks: Array<{ id: string; title: string; status: string }> = internalTasks || []

  // Stats calculation
  const pendingCount = allClientTasks.length
  const now = new Date()
  const overdueCount = allClientTasks.filter(t =>
    t.due_date && new Date(t.due_date) < now
  ).length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">TA</span>
              </div>
              <span className="text-lg font-bold text-gray-900">TaskApp</span>
              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded">
                クライアント
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{spaceName}</span>
              <form action="/api/auth/logout" method="POST">
                <button
                  type="submit"
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  ログアウト
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">ダッシュボード</h1>
          <p className="mt-1 text-sm text-gray-600">
            確認が必要なタスクとレビュー項目を確認できます
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* 確認待ち (ball=client tasks) */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-amber-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-600">確認待ち</p>
                <p className="text-2xl font-bold text-gray-900">{pendingCount}</p>
              </div>
            </div>
          </div>

          {/* 期限切れ */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-600">期限切れ</p>
                <p className="text-2xl font-bold text-red-600">{overdueCount}</p>
              </div>
            </div>
          </div>

          {/* 完了済み */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-600">完了済み</p>
                <p className="text-2xl font-bold text-gray-900">{completedCount || 0}</p>
              </div>
            </div>
          </div>
        </div>

        {/* AT-010: ball=client tasks shown FIRST (priority section) */}
        <div className="bg-white rounded-xl shadow-sm border border-amber-200 mb-6">
          <div className="px-6 py-4 border-b border-amber-200 bg-amber-50 rounded-t-xl">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-amber-500 rounded-full"></div>
              <h2 className="text-lg font-semibold text-gray-900">確認が必要なタスク</h2>
              <span className="text-sm text-amber-700">（お客様対応待ち）</span>
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {allClientTasks.length === 0 ? (
              <div className="p-6">
                <div className="text-center py-8">
                  <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-gray-500">確認が必要なタスクはありません</p>
                </div>
              </div>
            ) : (
              allClientTasks.map((task) => (
                <Link
                  key={task.id}
                  href={`/portal/task/${task.id}`}
                  className="block px-6 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-gray-900 truncate">
                          {task.title}
                        </h3>
                        {task.type === 'spec' && (
                          <span className="px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
                            仕様
                          </span>
                        )}
                        {task.status === 'considering' && (
                          <span className="px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">
                            検討中
                          </span>
                        )}
                      </div>
                      {task.due_date && (
                        <p className={`text-xs mt-1 ${
                          new Date(task.due_date) < now ? 'text-red-600 font-medium' : 'text-gray-500'
                        }`}>
                          期限: {new Date(task.due_date).toLocaleDateString('ja-JP')}
                          {new Date(task.due_date) < now && ' (期限切れ)'}
                        </p>
                      )}
                    </div>
                    <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* ball=internal tasks (shown below, minimal info for visibility only) */}
        {allInternalTasks.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">進行中のタスク</h2>
              <p className="text-xs text-gray-500">開発チームが対応中（{allInternalTasks.length}件）</p>
            </div>
            <div className="divide-y divide-gray-100">
              {allInternalTasks.map((task) => (
                <div
                  key={task.id}
                  className="px-6 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 truncate flex-1">
                      {task.title}
                    </span>
                    <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500 rounded shrink-0">
                      {task.status === 'in_progress' ? '対応中' : '未着手'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
