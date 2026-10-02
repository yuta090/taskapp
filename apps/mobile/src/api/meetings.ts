/**
 * 会議・議事録の読み取り。スマホは読むだけ（作成・編集・開始/終了・タスク化は Web）。
 * 見える範囲は RLS が決める（相手先は進行中・終了の会議だけ）。アプリ側で絞らない。
 */
import { fetchMeetingsQuery, MEETING_DETAIL_COLUMNS, type MeetingsQueryData } from '@/lib/supabase/queries'
import type { Meeting } from '@/types/database'
import { supabase } from './supabase'

export type SpaceMeetingsData = MeetingsQueryData

/** プロジェクトの会議の一覧（本文なし）。Web の会議一覧（useMeetings）と同じ fetchMeetingsQuery で、全件を range ページングで読む */
export function fetchMeetings(spaceId: string): Promise<SpaceMeetingsData> {
  return fetchMeetingsQuery(supabase, spaceId)
}

/** 議事録の本文つき・1件。Web の useMeetings.fetchMeetingDetail と同じ列（MEETING_DETAIL_COLUMNS・minutes_md を含む） */
export async function fetchMeetingMinutes(meetingId: string): Promise<Meeting | null> {
  const { data, error } = await supabase.from('meetings').select(MEETING_DETAIL_COLUMNS).eq('id', meetingId).maybeSingle()
  if (error) throw error
  return (data as Meeting | null) ?? null
}
