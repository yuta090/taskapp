/**
 * プロジェクト（spaces）の読み取り。マイタスクの fetchMyTasks と同じ問い合わせ
 * （Web の src/app/(internal)/my/MyTasksClient.tsx）。見える範囲は RLS が決める。
 */
import type { Space } from '@/types/database'
import { supabase } from './supabase'

export async function fetchSpaces(orgId: string): Promise<Space[]> {
  const { data, error } = await supabase.from('spaces').select('*').eq('org_id', orgId)
  if (error) throw error
  return (data ?? []) as Space[]
}
