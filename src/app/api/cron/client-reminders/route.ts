import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendReminderEmail } from '@/lib/email/reminder'
import {
  computeClientReminders,
  type ReminderTaskInput,
  type ReminderRecipient,
  type SentLogEntry,
} from '@/lib/reminders/computeClientReminders'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * POST /api/cron/client-reminders
 *
 * pg_cron が1日3回（JST 9/13/17時）app_invoke_client_reminders() 経由で
 * pg_net から呼び出す内部API。ボールがクライアントにある滞留タスクを集計し、
 * 受信者ごとに1通のダイジェストメールを送信する。
 *
 * 認証: Authorization: Bearer ${CRON_SECRET}。
 * dryRun=true の場合は送信・ログ記録を行わず、計画のみを返す。
 * recipientOverride が指定された場合は、全ダイジェストをそのアドレス宛に送信し
 * （動作確認用）、送信済みログへの記録はスキップする。
 */
export async function POST(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      console.error('[client-reminders] CRON_SECRET is not configured')
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
    }

    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: Record<string, unknown> = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }

    const url = new URL(request.url)
    const dryRun = url.searchParams.get('dryRun') === 'true' || body.dryRun === true
    const recipientOverride =
      url.searchParams.get('recipientOverride') ||
      (typeof body.recipientOverride === 'string' ? body.recipientOverride : null)

    const admin = createAdminClient() as SupabaseClient
    const now = new Date()

    const { data: rawTasks, error: tasksError } = await admin
      .from('tasks')
      .select('id, title, space_id, due_date, updated_at')
      .eq('ball', 'client')
      .neq('status', 'done')
      .eq('client_scope', 'deliverable')

    if (tasksError) {
      console.error('[client-reminders] Failed to fetch tasks:', tasksError)
      return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 })
    }

    const tasks = (rawTasks || []) as Array<{
      id: string
      title: string
      space_id: string
      due_date: string | null
      updated_at: string
    }>

    if (tasks.length === 0) {
      const empty = computeClientReminders({ tasks: [], recipients: [], sentLogs: [], now })
      return NextResponse.json({
        todayJst: empty.todayJst,
        slot: empty.slot,
        digestCount: 0,
        emailsSent: 0,
        tasksNotified: 0,
        errors: [],
        ...(dryRun ? { dryRun: true, plan: [] } : {}),
      })
    }

    const taskIds = tasks.map((t) => t.id)
    const spaceIds = [...new Set(tasks.map((t) => t.space_id))]

    const [{ data: spaces }, { data: taskOwners }, { data: passBallEvents }] = await Promise.all([
      admin.from('spaces').select('id, name').in('id', spaceIds),
      admin.from('task_owners').select('task_id, user_id').eq('side', 'client').in('task_id', taskIds),
      admin
        .from('task_events')
        .select('task_id, payload, created_at')
        .eq('action', 'PASS_BALL')
        .in('task_id', taskIds)
        .order('created_at', { ascending: true }),
    ])

    const spaceNameById = new Map((spaces || []).map((s: { id: string; name: string }) => [s.id, s.name]))

    const ownersByTask = new Map<string, string[]>()
    for (const o of (taskOwners || []) as Array<{ task_id: string; user_id: string }>) {
      const list = ownersByTask.get(o.task_id) || []
      list.push(o.user_id)
      ownersByTask.set(o.task_id, list)
    }

    // オーナー未設定タスクは、そのスペースのクライアントメンバー全員にフォールバック
    // (src/app/api/portal/notify-approval/route.ts と同じ方針)
    const tasksNeedingFallback = tasks.filter((t) => (ownersByTask.get(t.id) || []).length === 0)
    const fallbackSpaceIds = [...new Set(tasksNeedingFallback.map((t) => t.space_id))]
    const clientMembersBySpace = new Map<string, string[]>()
    if (fallbackSpaceIds.length > 0) {
      const { data: clientMembers } = await admin
        .from('space_memberships')
        .select('space_id, user_id')
        .eq('role', 'client')
        .in('space_id', fallbackSpaceIds)
      for (const m of (clientMembers || []) as Array<{ space_id: string; user_id: string }>) {
        const list = clientMembersBySpace.get(m.space_id) || []
        list.push(m.user_id)
        clientMembersBySpace.set(m.space_id, list)
      }
    }

    // ballSince: task_events の PASS_BALL(payload.ball='client') の最新 created_at。無ければ updated_at
    const ballSinceByTask = new Map<string, string>()
    for (const ev of (passBallEvents || []) as Array<{ task_id: string; payload: Record<string, unknown> | null; created_at: string }>) {
      if (ev.payload?.ball !== 'client') continue
      const existing = ballSinceByTask.get(ev.task_id)
      if (!existing || new Date(ev.created_at) > new Date(existing)) {
        ballSinceByTask.set(ev.task_id, ev.created_at)
      }
    }

    const reminderTasks: ReminderTaskInput[] = tasks.map((t) => {
      const owners = ownersByTask.get(t.id) || []
      const clientOwnerIds = owners.length > 0 ? owners : clientMembersBySpace.get(t.space_id) || []
      return {
        id: t.id,
        title: t.title,
        spaceId: t.space_id,
        spaceName: spaceNameById.get(t.space_id) || 'プロジェクト',
        dueDate: t.due_date,
        ballSince: ballSinceByTask.get(t.id) || t.updated_at,
        clientOwnerIds,
      }
    })

    const allRecipientIds = [...new Set(reminderTasks.flatMap((t) => t.clientOwnerIds))]

    if (allRecipientIds.length === 0) {
      const empty = computeClientReminders({ tasks: [], recipients: [], sentLogs: [], now })
      return NextResponse.json({
        todayJst: empty.todayJst,
        slot: empty.slot,
        digestCount: 0,
        emailsSent: 0,
        tasksNotified: 0,
        errors: [],
        ...(dryRun ? { dryRun: true, plan: [] } : {}),
      })
    }

    // profiles に email 列は無い（メールの正は auth.users）。email を select に含めると
    // クエリ全体が column does not exist で失敗し、オプトアウト設定まで無視されてしまう。
    const { data: profiles, error: profilesError } = await admin
      .from('profiles')
      .select('id, display_name, reminder_emails_enabled')
      .in('id', allRecipientIds)

    if (profilesError) {
      console.error('[client-reminders] Failed to fetch profiles:', profilesError)
      return NextResponse.json({ error: 'Failed to fetch profiles' }, { status: 500 })
    }

    type ProfileRow = { id: string; display_name: string | null; reminder_emails_enabled: boolean }
    const profileById = new Map(((profiles || []) as ProfileRow[]).map((p) => [p.id, p]))

    // メールアドレスは auth.users から解決する
    const emailById = new Map<string, string>()
    await Promise.all(
      allRecipientIds.map(async (id) => {
        const { data } = await admin.auth.admin.getUserById(id)
        if (data.user?.email) emailById.set(id, data.user.email)
      })
    )

    const recipients: ReminderRecipient[] = allRecipientIds
      .filter((id) => emailById.has(id))
      .map((id) => {
        const profile = profileById.get(id)
        return {
          userId: id,
          email: emailById.get(id) as string,
          displayName: profile?.display_name || null,
          remindersEnabled: profile?.reminder_emails_enabled !== false,
        }
      })

    // 今日(JST)分の送信済みログを取得（dedupe用）。todayJst の算出だけ先に行うため、
    // 空のsentLogsで一度呼んで todayJst/slot を得てからクエリする。
    const { todayJst } = computeClientReminders({ tasks: [], recipients: [], sentLogs: [], now })

    const { data: sentLogRows } = await admin
      .from('client_reminder_log')
      .select('task_id, recipient_user_id, kind, sent_on, slot')
      .eq('sent_on', todayJst)
      .in('task_id', taskIds)

    const sentLogs: SentLogEntry[] = ((sentLogRows || []) as Array<{
      task_id: string
      recipient_user_id: string
      kind: SentLogEntry['kind']
      sent_on: string
      slot: number
    }>).map((row) => ({
      taskId: row.task_id,
      recipientUserId: row.recipient_user_id,
      kind: row.kind,
      sentOn: row.sent_on,
      slot: row.slot,
    }))

    const result = computeClientReminders({ tasks: reminderTasks, recipients, sentLogs, now })

    if (dryRun) {
      return NextResponse.json({
        todayJst: result.todayJst,
        slot: result.slot,
        digestCount: result.digests.length,
        emailsSent: 0,
        tasksNotified: countNotifiedTasks(result.digests),
        errors: [],
        dryRun: true,
        plan: result.digests,
      })
    }

    let emailsSent = 0
    const errors: string[] = []
    const successfulLogEntries: SentLogEntry[] = []

    await Promise.allSettled(
      result.digests.map(async (digest) => {
        try {
          await sendReminderEmail({
            to: recipientOverride || digest.email,
            displayName: digest.displayName,
            digest: { overdue: digest.overdue, dueToday: digest.dueToday, stalled: digest.stalled },
          })
          emailsSent += 1
          if (!recipientOverride) {
            const entries = result.logEntries.filter((e) => e.recipientUserId === digest.recipientUserId)
            successfulLogEntries.push(...entries)
          }
        } catch (err) {
          console.error(`[client-reminders] Failed to send to ${digest.email}:`, err)
          errors.push(`${digest.email}: ${err instanceof Error ? err.message : 'unknown error'}`)
        }
      })
    )

    if (successfulLogEntries.length > 0) {
      const { error: logError } = await admin
        .from('client_reminder_log')
        .upsert(
          successfulLogEntries.map((e) => ({
            task_id: e.taskId,
            recipient_user_id: e.recipientUserId,
            kind: e.kind,
            sent_on: e.sentOn,
            slot: e.slot,
          })),
          { onConflict: 'task_id,recipient_user_id,kind,sent_on,slot', ignoreDuplicates: true }
        )
      if (logError) {
        console.error('[client-reminders] Failed to write reminder log entries:', logError)
      }
    }

    return NextResponse.json({
      todayJst: result.todayJst,
      slot: result.slot,
      digestCount: result.digests.length,
      emailsSent,
      tasksNotified: countNotifiedTasks(result.digests),
      errors,
    })
  } catch (error) {
    console.error('[client-reminders] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

function countNotifiedTasks(digests: ReturnType<typeof computeClientReminders>['digests']): number {
  const ids = new Set<string>()
  for (const digest of digests) {
    for (const ref of [...digest.overdue, ...digest.dueToday, ...digest.stalled]) {
      ids.add(ref.taskId)
    }
  }
  return ids.size
}
