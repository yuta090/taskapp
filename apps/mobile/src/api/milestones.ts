/**
 * マイルストーンの読み取り。スマホは読むだけ（作成・編集は Web）。
 * 見える範囲は RLS が決める。アプリ側で絞らない。
 */
import { fetchMilestonesQuery } from '@/lib/supabase/queries'
import type { Milestone } from '@/types/database'
import { supabase } from './supabase'

/** プロジェクトのマイルストーン一覧（order_key の昇順）。Web の useMilestones と同じ fetchMilestonesQuery */
export function fetchMilestones(spaceId: string): Promise<Milestone[]> {
  return fetchMilestonesQuery(supabase, spaceId)
}
