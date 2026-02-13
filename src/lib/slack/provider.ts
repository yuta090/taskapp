import { createClient } from '@supabase/supabase-js'
import type {
  NotificationProvider,
  NotificationEventType,
  NotificationContext,
  TaskNotificationPayload,
  NotificationResult,
} from '@/lib/notifications/types'
import { isSlackFullyConfigured } from './config'
import { postSlackMessage } from './client'
import { buildTaskBlocks, buildTaskFallbackText } from './blocks'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const EVENT_TO_COLUMN: Partial<Record<NotificationEventType, string>> = {
  task_created: 'notify_task_created',
  ball_passed: 'notify_ball_passed',
  status_changed: 'notify_status_changed',
  comment_added: 'notify_comment_added',
}

export class SlackNotificationProvider implements NotificationProvider {
  readonly name = 'slack'

  isConfigured(): boolean {
    return isSlackFullyConfigured()
  }

  async isSpaceConfigured(spaceId: string): Promise<boolean> {
    const { data } = await (supabaseAdmin as any)
      .from('space_slack_channels')
      .select('id')
      .eq('space_id', spaceId)
      .single()

    return !!data
  }

  async sendTaskNotification(
    event: NotificationEventType,
    context: NotificationContext,
    payload: TaskNotificationPayload,
  ): Promise<NotificationResult> {
    // 1. Get channel config
    const { data: channelConfig } = await (supabaseAdmin as any)
      .from('space_slack_channels')
      .select('*, slack_workspaces!inner(org_id)')
      .eq('space_id', context.spaceId)
      .single()

    if (!channelConfig) {
      return { messageId: null }
    }

    // 2. Check if this event type is enabled (manual shares always send)
    if (event !== 'task_shared') {
      const column = EVENT_TO_COLUMN[event]
      if (column && !channelConfig[column]) {
        return { messageId: null }
      }
    }

    // 3. Build message
    const blocks = buildTaskBlocks(event, payload)
    const text = buildTaskFallbackText(event, payload)

    // 4. Send to Slack (using orgId from channel config)
    const orgId = context.orgId
    const dedupeKey = `slack:${event}:${context.taskId || context.spaceId}:${Date.now().toString(36)}`

    try {
      const result = await postSlackMessage(orgId, channelConfig.channel_id, text, blocks)

      // 5. Log success
      await (supabaseAdmin as any).from('slack_message_logs').insert({
        org_id: orgId,
        space_id: context.spaceId,
        channel_id: channelConfig.channel_id,
        message_type: event,
        task_id: context.taskId || null,
        slack_ts: result.ts,
        payload: { blocks, text },
        dedupe_key: dedupeKey,
        status: result.ok ? 'sent' : 'failed',
        sent_by: context.actorId || null,
      })

      return { messageId: result.ts || null }
    } catch (err) {
      // Log failure
      await (supabaseAdmin as any).from('slack_message_logs').insert({
        org_id: orgId,
        space_id: context.spaceId,
        channel_id: channelConfig.channel_id,
        message_type: event,
        task_id: context.taskId || null,
        payload: { blocks, text },
        dedupe_key: dedupeKey,
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Unknown error',
        sent_by: context.actorId || null,
      })

      return {
        messageId: null,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }
}
