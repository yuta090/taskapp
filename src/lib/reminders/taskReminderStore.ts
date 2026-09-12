/**
 * 時刻指定タスクリマインド（③）のデータアクセス層（service role専用）。
 * tasks（remind_at）と channel_groups（LINE/Slack等の配信先・全チャネル）を橋渡しする薄いラッパー。
 * org境界の帰属は必ず channel_groups.org_id を真実源にする（accountや別経路から導出しない）。
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TaskReminderInput } from './computeTaskReminders'

function admin(): SupabaseClient {
  return createAdminClient() as SupabaseClient
}

/**
 * remind_at が到来済み（<= now）で未完了のタスクを返す。
 * 「送信済みか（remind_sent_at と remind_at の比較・再アーム）」の絞り込みは
 * PostgREST が列同士比較を素直に書けないため、呼び出し側の純粋関数
 * selectDueTaskReminders に委ねる（部分インデックスでスキャンは限定される）。
 */
export async function findDueTaskReminders(nowISO: string): Promise<TaskReminderInput[]> {
  const { data, error } = await admin()
    .from('tasks')
    .select('id, title, space_id, due_date, remind_at, remind_sent_at, status')
    .not('remind_at', 'is', null)
    .lte('remind_at', nowISO)
    .neq('status', 'done')

  if (error || !data) return []

  type Row = {
    id: string
    title: string
    space_id: string
    due_date: string | null
    remind_at: string | null
    remind_sent_at: string | null
    status: string
  }

  return (data as Row[]).map((row) => ({
    id: row.id,
    title: row.title,
    spaceId: row.space_id,
    dueDate: row.due_date,
    remindAt: row.remind_at,
    remindSentAt: row.remind_sent_at,
    status: row.status,
  }))
}

export interface ReminderGroupLink {
  /** channel_groups.id（内部id）。channel_messages.group_id の帰属に使う（統一送信境界 PR-0.5） */
  id: string
  spaceId: string
  orgId: string
  accountId: string
  externalGroupId: string
  ownerType: string // 'platform'（共有Bot）| 'org'（専用bot）。配信先の優先判定に使う
  /** channel_accounts.channel（'line' | 'slack' | ...）。共有Bot優先はチャネル内だけで効かせる */
  channel: string
  /** channel_groups.metadata（teams の serviceUrl 等・チャネル固有の送信文脈）。無ければ null */
  metadata: Record<string, unknown> | null
}

/**
 * 指定した space に紐づく、配信可能な（active × accountもactive）チャットグループを全チャネル分返す。
 * digest とは独立（pickup_mode を問わない）。org帰属は channel_groups.org_id。
 * 配信先の絞り込み（共有Bot優先）は route 側で preferPlatformLinks が行う。
 */
export async function findActiveGroupsForSpaces(spaceIds: string[]): Promise<ReminderGroupLink[]> {
  if (spaceIds.length === 0) return []

  const { data, error } = await admin()
    .from('channel_groups')
    .select('id, space_id, org_id, account_id, external_group_id, metadata, channel_accounts!inner(status, owner_type, channel)')
    .eq('status', 'active')
    .eq('channel_accounts.status', 'active')
    .in('space_id', spaceIds)

  if (error || !data) return []

  type Row = {
    id: string
    space_id: string | null
    org_id: string
    account_id: string
    external_group_id: string
    metadata: Record<string, unknown> | null
    channel_accounts: { owner_type: string; channel: string } | { owner_type: string; channel: string }[]
  }

  return (data as unknown as Row[])
    .filter((row): row is Row & { space_id: string } => row.space_id !== null)
    .map((row) => {
      const acct = Array.isArray(row.channel_accounts) ? row.channel_accounts[0] : row.channel_accounts
      return {
        id: row.id,
        spaceId: row.space_id,
        orgId: row.org_id,
        accountId: row.account_id,
        externalGroupId: row.external_group_id,
        ownerType: acct?.owner_type ?? 'org',
        channel: acct?.channel ?? 'line',
        metadata: row.metadata ?? null,
      }
    })
}

/** 送信成功したタスクに remind_sent_at（絶対時刻）を刻む。 */
export async function markTaskReminderSent(taskId: string, sentAtISO: string): Promise<void> {
  const { error } = await admin()
    .from('tasks')
    .update({ remind_sent_at: sentAtISO })
    .eq('id', taskId)

  if (error) {
    throw new Error(`markTaskReminderSent failed for ${taskId}: ${error.message}`)
  }
}

/**
 * 設定時ゲート用: タスクが所属する org を導出する（tasks.space_id -> spaces.org_id）。
 * 見つからなければ null。
 * tasks → spaces の外部キーは2本あるため（20260911155718_space_org_fk.sql）、道を明示する。
 */
export async function findTaskOrgId(taskId: string): Promise<{ orgId: string; spaceId: string } | null> {
  const { data, error } = await admin()
    .from('tasks')
    .select('space_id, spaces!tasks_space_id_fkey!inner(org_id)')
    .eq('id', taskId)
    .maybeSingle()

  if (error || !data) return null
  const row = data as unknown as { space_id: string; spaces: { org_id: string } }
  if (!row.spaces?.org_id) return null
  return { orgId: row.spaces.org_id, spaceId: row.space_id }
}

/** 設定時: remind_at を設定/解除し、再アームのため remind_sent_at をクリアする。 */
export async function setTaskRemindAt(taskId: string, remindAtISO: string | null): Promise<void> {
  const { error } = await admin()
    .from('tasks')
    .update({ remind_at: remindAtISO, remind_sent_at: null })
    .eq('id', taskId)

  if (error) {
    throw new Error(`setTaskRemindAt failed for ${taskId}: ${error.message}`)
  }
}
