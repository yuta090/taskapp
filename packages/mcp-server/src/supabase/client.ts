import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { config, getAuthContextOrNull } from '../config.js'
import type { AuthContext } from '../auth/authorize.js'

let supabaseInstance: SupabaseClient | null = null

/**
 * ctx（AsyncLocalStorage の認証コンテキスト）ごとに1個だけ作る。WeakMap なので
 * ctx がリクエストの終わりに GC されれば一緒に片付く。同じ呼び出しの中で
 * getSupabaseClient() を何度呼んでも、request-id 等のヘッダーが変わらないようにする。
 */
const clientsByCtx = new WeakMap<AuthContext, SupabaseClient>()

function assertConfigured(): void {
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    throw new Error(
      'Supabase not configured. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY)',
    )
  }
}

/**
 * change_log トリガー（誰が・どの経路で書いたか。supabase 側 PR #1027）向けのヘッダー。
 * service_role の JWT を使うときだけ DB 側が信用する。ここで使うのは AsyncLocalStorage
 * に積まれた「このサーバー自身が認証した ctx」だけで、外から来たリクエストのヘッダーは
 * 一切見ない（なりすまし防止）。
 */
function buildAttributionHeaders(ctx: AuthContext): Record<string, string> {
  const headers: Record<string, string> = {
    'x-agentpm-channel': ctx.channel,
    'x-agentpm-request-id': randomUUID(),
  }
  if (ctx.userId) headers['x-agentpm-actor-id'] = ctx.userId
  // 'dev-key' はローカル開発の目印（本物の鍵ではない）。cli_usage_logs 等への記録でも
  // 同様に除外している（src/app/api/tools/route.ts 等）
  if (ctx.keyId && ctx.keyId !== 'dev-key') headers['x-agentpm-api-key-id'] = ctx.keyId
  return headers
}

export function getSupabaseClient(): SupabaseClient {
  const ctx = getAuthContextOrNull()

  if (!ctx) {
    if (!supabaseInstance) {
      assertConfigured()
      supabaseInstance = createClient(config.supabaseUrl, config.supabaseServiceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })
    }
    return supabaseInstance
  }

  const cached = clientsByCtx.get(ctx)
  if (cached) return cached

  assertConfigured()
  const client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: { headers: buildAttributionHeaders(ctx) },
  })
  clientsByCtx.set(ctx, client)
  return client
}

// Type definitions for TaskApp tables
export interface Task {
  id: string
  org_id: string
  space_id: string
  milestone_id: string | null
  title: string
  description: string | null
  status: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'considering'
  priority: number | null
  assignee_id: string | null
  assignee_invite_id?: string | null
  due_date: string | null
  ball: 'client' | 'internal'
  origin: 'client' | 'internal'
  type: 'task' | 'spec'
  spec_path: string | null
  decision_state: 'considering' | 'decided' | 'implemented' | null
  client_scope: 'deliverable' | 'internal'
  parent_task_id: string | null
  start_date: string | null
  actual_hours: number | null
  // サービス全体の通し番号(TP-42等の表示に使う)。tasks_short_id_seq のトリガーで自動採番。
  short_id?: number | null
  created_at: string
  updated_at: string
}

export interface TaskOwner {
  id: string
  org_id: string
  space_id: string
  task_id: string
  side: 'client' | 'internal'
  user_id: string
  created_at: string
}

export interface Meeting {
  id: string
  org_id: string
  space_id: string
  title: string
  held_at: string | null
  notes: string | null
  status: 'planned' | 'in_progress' | 'ended'
  started_at: string | null
  ended_at: string | null
  minutes_md: string | null
  summary_subject: string | null
  summary_body: string | null
  created_at: string
  updated_at: string
}

export interface WikiPage {
  id: string
  org_id: string
  space_id: string
  title: string
  body: string
  tags: string[]
  parent_page_id: string | null
  milestone_id: string | null
  pinned_at: string | null
  sort_order: number | null
  is_folder: boolean
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

export interface WikiPageVersion {
  id: string
  org_id: string
  page_id: string
  title: string
  body: string
  created_by: string
  created_at: string
  /**
   * 版の種類。autosave=本文の自動保存でできた控え /
   * decided・implemented=タスクを確定したときの控え（＝確定した瞬間の内容）。
   * 書けるのはサーバー側の rpc_set_spec_state だけ（画面・CLI からは印を付けられない）。
   */
  kind: 'autosave' | 'decided' | 'implemented'
  /** kind が autosave でないとき、その確定を行ったタスク（タスク） */
  task_id: string | null
}

export interface Space {
  id: string
  org_id: string
  type: 'project' | 'personal'
  name: string
  owner_user_id: string | null
  created_at: string
}

export interface Organization {
  id: string
  name: string
  created_at: string
  updated_at: string
}

export type BallSide = 'client' | 'internal'
export type TaskType = 'task' | 'spec'
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'considering'
export type DecisionState = 'considering' | 'decided' | 'implemented'
export type ClientScope = 'deliverable' | 'internal'
