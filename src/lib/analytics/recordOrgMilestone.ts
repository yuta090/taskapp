'use client'

import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * アプリから直接記録できる節目（DB の rpc_record_org_milestone のホワイトリストと一致させる）。
 * 元データに時刻が残らないものだけ。それ以外は reconcile_org_milestones() が既存データから導出する。
 */
export type AppRecordableMilestone = 'portal_previewed'

/**
 * 節目を1つ記録する（同じ節目は最初の1回だけ残る）。
 * 分析のための記録なので、失敗しても画面は止めない（警告ログのみ）。
 */
export async function recordOrgMilestone(orgId: string, milestone: AppRecordableMilestone): Promise<void> {
  try {
    const supabase = createClient() as SupabaseClient
    const { error } = await supabase.rpc('rpc_record_org_milestone', { p_org_id: orgId, p_milestone: milestone })
    if (error) console.warn(`Failed to record milestone ${milestone}:`, error.message)
  } catch (err) {
    console.warn(`Failed to record milestone ${milestone}:`, err)
  }
}
