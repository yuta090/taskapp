/**
 * タスクのコメント（Web の useTaskComments と同じ読み書き）。
 * 受信トレイへの通知（メンション・コメントが付いた）は DB のトリガー（task_comments_notify）が作る。
 *
 * 既知の差: Web は「相手先にも見える」コメントのとき Slack にも知らせる（/api/slack/notify）。
 * そのサーバーはブラウザのログイン（Cookie）でしか呼べないので、アプリからのコメントでは Slack に出ない。
 */
import type { CommentVisibility, TaskComment } from '@/types/database'
import { supabase } from './supabase'

export interface CommentWithAuthor extends TaskComment {
  authorName: string
}

export async function fetchComments(task: { id: string; org_id: string; space_id: string }): Promise<CommentWithAuthor[]> {
  const { data, error } = await supabase
    .from('task_comments')
    .select('*')
    .eq('org_id', task.org_id)
    .eq('space_id', task.space_id)
    .eq('task_id', task.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  const comments = (data ?? []) as TaskComment[]

  const actorIds = [...new Set(comments.map((c) => c.actor_id))]
  const names = new Map<string, string>()
  if (actorIds.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', actorIds)
    if (profileError) throw profileError
    for (const p of (profiles ?? []) as { id: string; display_name: string }[]) names.set(p.id, p.display_name)
  }
  return comments.map((c) => ({ ...c, authorName: names.get(c.actor_id) ?? '不明なユーザー' }))
}

export async function addComment(
  task: { id: string; org_id: string; space_id: string },
  actorId: string,
  body: string,
  visibility: CommentVisibility
): Promise<void> {
  const { error } = await supabase.from('task_comments').insert({
    org_id: task.org_id,
    space_id: task.space_id,
    task_id: task.id,
    actor_id: actorId,
    body,
    visibility,
  })
  if (error) throw error
}
