import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAuditLog, generateAuditSummary } from '@/lib/audit'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Fire-and-forget server-side notification.
 * Uses X-Internal-Secret header for authentication (no user session needed).
 */
function fireServerNotification(
  request: NextRequest,
  params: {
    event: string
    taskId: string
    spaceId: string
    actorId: string
    changes?: Record<string, string | undefined>
  },
): void {
  const secret = process.env.INTERNAL_NOTIFY_SECRET
  if (!secret) return

  const origin = request.nextUrl.origin
  fetch(`${origin}/api/slack/notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': secret,
    },
    body: JSON.stringify(params),
  }).catch((err) => {
    console.warn('[portal-notify] Failed:', err)
  })
}

interface TaskActionBody {
  action: 'approve' | 'request_changes'
  comment?: string
}

// Maximum comment length
const MAX_COMMENT_LENGTH = 2000

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params

  try {
    const supabase = await createClient()

    // Verify user is authenticated
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse request body
    const body: TaskActionBody = await request.json()
    const { action, comment } = body

    if (!action || !['approve', 'request_changes'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be "approve" or "request_changes"' },
        { status: 400 }
      )
    }

    // Server-side validation: request_changes requires a comment
    if (action === 'request_changes') {
      if (!comment || comment.trim().length === 0) {
        return NextResponse.json(
          { error: 'Comment is required for change requests' },
          { status: 400 }
        )
      }
      if (comment.length > MAX_COMMENT_LENGTH) {
        return NextResponse.json(
          { error: `Comment must be ${MAX_COMMENT_LENGTH} characters or less` },
          { status: 400 }
        )
      }
    }

    // Validate comment length for approve action too (if provided)
    if (comment && comment.length > MAX_COMMENT_LENGTH) {
      return NextResponse.json(
        { error: `Comment must be ${MAX_COMMENT_LENGTH} characters or less` },
        { status: 400 }
      )
    }

    // Fetch task details and verify membership in parallel
     
    const taskPromise = (supabase as SupabaseClient)
      .from('tasks')
      .select('id, org_id, space_id, title, status, ball, type')
      .eq('id', taskId)
      .single()

    const { data: task, error: taskError } = await taskPromise

    if (taskError || !task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      )
    }

    // Server-side validation: task must be in client's court
    if (task.ball !== 'client') {
      return NextResponse.json(
        { error: 'This task is not currently awaiting client action' },
        { status: 409 }
      )
    }

    // Server-side validation: task must not already be done
    if (task.status === 'done') {
      return NextResponse.json(
        { error: 'This task is already completed' },
        { status: 409 }
      )
    }

    // Verify user has access to this task's space (is a client member)
     
    const { data: membership } = await (supabase as SupabaseClient)
      .from('space_memberships')
      .select('id, role')
      .eq('space_id', task.space_id)
      .eq('user_id', user.id)
      .eq('role', 'client')
      .single()

    if (!membership) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      )
    }

    const now = new Date().toISOString()
    // Safe trimmed comment for use in request_changes branch
    const trimmedComment = comment?.trim() || ''

    if (action === 'approve') {
      // Update task status to done and transfer ball to internal
      // IMPORTANT: Include ball='client' in WHERE clause to prevent race conditions
       
      const { data: updatedTask, error: updateError } = await (supabase as SupabaseClient)
        .from('tasks')
        .update({
          status: 'done',
          ball: 'internal',
          updated_at: now,
        })
        .eq('id', taskId)
        .eq('ball', 'client')  // Race condition protection
        .neq('status', 'done') // Don't update already-done tasks
        .select('id')
        .single()

      if (updateError || !updatedTask) {
        // If no row was updated, it means the task state changed (race condition)
        console.error('Error approving task:', updateError || 'No rows updated')
        return NextResponse.json(
          { error: 'Task state has changed. Please refresh and try again.' },
          { status: 409 }
        )
      }

      // Fire-and-forget: audit log should not block the response
      createAuditLog({
        supabase,
        orgId: task.org_id,
        spaceId: task.space_id,
        actorId: user.id,
        actorRole: 'client',
        eventType: 'approval.approved',
        targetType: 'task',
        targetId: taskId,
        summary: generateAuditSummary('approval.approved', { title: task.title }),
        dataBefore: { status: task.status, ball: task.ball },
        dataAfter: { status: 'done', ball: 'internal' },
        metadata: { comment: comment?.trim() || null },
        visibility: 'client',
      }).catch(err => console.error('Audit log failed (approve):', err))

      // Fire-and-forget: Slack notification for status change
      fireServerNotification(request, {
        event: 'status_changed',
        taskId,
        spaceId: task.space_id,
        actorId: user.id,
        changes: { oldStatus: task.status, newStatus: 'done' },
      })

      return NextResponse.json({
        success: true,
        message: 'Task approved successfully',
        taskId,
      })
    } else {
      // action === 'request_changes'
      // Transfer ball back to internal team
      // IMPORTANT: Include ball='client' in WHERE clause to prevent race conditions
       
      const { data: updatedTask, error: updateError } = await (supabase as SupabaseClient)
        .from('tasks')
        .update({
          ball: 'internal',
          updated_at: now,
        })
        .eq('id', taskId)
        .eq('ball', 'client')  // Race condition protection
        .neq('status', 'done') // Don't update already-done tasks
        .select('id')
        .single()

      if (updateError || !updatedTask) {
        // If no row was updated, it means the task state changed (race condition)
        console.error('Error requesting changes:', updateError || 'No rows updated')
        return NextResponse.json(
          { error: 'Task state has changed. Please refresh and try again.' },
          { status: 409 }
        )
      }

      // Run audit log (fire-and-forget) and comment insert (required) in parallel
       
      const commentPromise = (supabase as SupabaseClient)
        .from('task_comments')
        .insert({
          org_id: task.org_id,
          space_id: task.space_id,
          task_id: taskId,
          actor_id: user.id,
          body: trimmedComment,
          visibility: 'client',
          created_at: now,
          updated_at: now,
        })

      // Fire-and-forget: audit log should not block the response
      createAuditLog({
        supabase,
        orgId: task.org_id,
        spaceId: task.space_id,
        actorId: user.id,
        actorRole: 'client',
        eventType: 'approval.changes_requested',
        targetType: 'task',
        targetId: taskId,
        summary: generateAuditSummary('approval.changes_requested', { title: task.title }),
        dataBefore: { ball: task.ball },
        dataAfter: { ball: 'internal' },
        metadata: { comment: trimmedComment },
        visibility: 'client',
      }).catch(err => console.error('Audit log failed (request_changes):', err))

      // Fire-and-forget: Slack notification for ball passed back to internal
      fireServerNotification(request, {
        event: 'ball_passed',
        taskId,
        spaceId: task.space_id,
        actorId: user.id,
        changes: { newBall: 'internal' },
      })

      // Comment is required — await it
      const { error: commentError } = await commentPromise

      if (commentError) {
        console.error('Failed to create task comment:', commentError)

        // Attempt to revert the ball change (conditional to avoid clobbering newer state)
         
        await (supabase as SupabaseClient)
          .from('tasks')
          .update({ ball: 'client', updated_at: now })
          .eq('id', taskId)
          .eq('ball', 'internal')
          .eq('updated_at', now)

        return NextResponse.json(
          { error: 'Failed to save comment. Please try again.' },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        message: 'Changes requested successfully',
        taskId,
      })
    }
  } catch (error) {
    console.error('Portal task action error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
