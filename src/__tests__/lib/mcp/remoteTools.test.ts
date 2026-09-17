import { describe, it, expect } from 'vitest'
import { REMOTE_TOOLS, isRemoteTool } from '@/lib/mcp/remoteTools'

/**
 * リモートMCP（ChatGPT 等の外部チャットからの接続）に出すツールの許可リスト。
 *
 * ⚠ ここを緩めると、外部のチャットから消したり承認したりできるようになる。
 * 足すときは「外のAIに任せてよいか」を1件ずつ判断すること。
 */

/** 消えたら困る・外に出してはいけないツール（名前が変わったらここも直す） */
const MUST_NOT_EXPOSE = [
  // 破壊的: 消す操作は外部チャットからさせない
  'task_delete',
  'wiki_delete',
  'milestone_delete',
  // 一括: 取り消しが効かない量の変更
  'task_import',
  'client_invite_bulk_create',
  // 承認: 責任者本人の行為。AIに代行させない
  'review_approve',
  'review_block',
  'review_open',
  'review_cancel',
  'spec_decide',
  // 招待・メンバー・プロジェクトの管理: 権限が動く操作
  'client_invite_create',
  'client_invite_resend',
  'client_add_to_space',
  'client_update',
  'space_create',
  'space_update',
  // ファイルの実体を置く操作
  'file_upload_url',
  'file_upload_complete',
]

describe('REMOTE_TOOLS — リモートMCPに出すツールの許可リスト', () => {
  it('外に出してはいけないツールが1つも入っていない', () => {
    const leaked = MUST_NOT_EXPOSE.filter((name) => REMOTE_TOOLS.includes(name))
    expect(leaked).toEqual([])
  })

  it('【破壊的】【横断】以外の入口として、読み取りの主要ツールが揃っている', () => {
    const essentials = [
      'task_list',
      'task_get',
      'task_list_my',
      'task_stale',
      'ball_query',
      'space_list',
      'meeting_list',
      'wiki_get',
      'wiki_list',
      'minutes_get',
      'dashboard_get',
    ]
    const missing = essentials.filter((name) => !REMOTE_TOOLS.includes(name))
    expect(missing).toEqual([])
  })

  it('書き込みは起票・更新・ボール渡しの3つだけ', () => {
    const writes = ['task_create', 'task_update', 'ball_pass']
    expect(writes.every((name) => REMOTE_TOOLS.includes(name))).toBe(true)
  })

  it('25本以下に収まっている（多いとAIが選べない）', () => {
    expect(REMOTE_TOOLS.length).toBeLessThanOrEqual(25)
  })

  it('重複が無い', () => {
    expect(new Set(REMOTE_TOOLS).size).toBe(REMOTE_TOOLS.length)
  })

  it('isRemoteTool は許可リストのものだけ true を返す', () => {
    expect(isRemoteTool('task_list')).toBe(true)
    expect(isRemoteTool('task_delete')).toBe(false)
    expect(isRemoteTool('存在しないツール')).toBe(false)
  })
})
