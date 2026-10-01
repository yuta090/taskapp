/**
 * プロジェクトのタスクの読み取り。Web のプロジェクト画面（useTasks）と同じ fetchTasksQuery を呼ぶ
 * （全件を 1000件ずつ range ページングして読み切り、承認依頼の状態も返す）。自前でページングを書かない。
 */
import { fetchTasksQuery, type TasksQueryData } from '@/lib/supabase/queries'
import { supabase } from './supabase'

export type SpaceTasksData = TasksQueryData

export function fetchSpaceTasks(orgId: string, spaceId: string): Promise<SpaceTasksData> {
  return fetchTasksQuery(supabase, orgId, spaceId)
}
