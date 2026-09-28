/**
 * リモートMCP（/api/mcp）に出すツールの許可リスト。
 *
 * CLI（/api/tools）は67本すべてを使えるが、リモートMCPはそれより狭くする。理由は2つ。
 *
 * 1. 安全。外部のチャットにつながった先で、消す・承認する・権限を動かす操作をさせない。
 *    承認は責任者本人の行為なので、AIに代行させない。
 * 2. 選べること。AIに渡す道具が多いほど選択を誤る。MCPガバナンス v1.0 も Tier1 は
 *    40-60本を上限としており、1つのチャットに出す数はさらに絞る。
 *
 * ⚠ 足すときは「外のAIに任せてよい操作か」を1件ずつ判断すること。
 * 消す・一括で変える・承認する・権限を動かす操作は入れない（remoteTools.test.ts が見張る）。
 */

/** 読み取り。状況を聞かれて答えるための道具 */
const READ_TOOLS = [
  'task_list',
  'task_get',
  'task_list_my',
  'task_stale',
  'ball_query',
  'dashboard_get',
  'space_list',
  'space_get',
  'milestone_list',
  'milestone_get',
  'meeting_list',
  'meeting_get',
  'minutes_get',
  'minutes_taskify_preview',
  'review_list',
  'review_get',
  'client_list',
  'client_get',
  'wiki_list',
  'wiki_get',
] as const

/**
 * 書き込み。起票・更新・ボール渡しまで。
 * 取り消しが人手でできる範囲に留める（消す・承認するは入れない）。
 */
const WRITE_TOOLS = ['task_create', 'task_update', 'ball_pass'] as const

export const REMOTE_TOOLS: readonly string[] = [...READ_TOOLS, ...WRITE_TOOLS]

const REMOTE_TOOL_SET = new Set(REMOTE_TOOLS)
const WRITE_TOOL_SET = new Set<string>(WRITE_TOOLS)

/** その名前のツールをリモートMCPに出してよいか */
export function isRemoteTool(name: string): boolean {
  return REMOTE_TOOL_SET.has(name)
}

/**
 * その接続の権限で使ってよいツールか。
 *
 * 「見るだけ」で許可した接続には、書き込みの道具を**一覧にも出さない**。
 * 出したうえで実行時に断ると、AI が何度も試して利用者には理由が見えない。
 * 一覧に出さないのは親切のためで、守りの本体は DB 側（mcp_authorize が
 * 鍵の allowed_actions を再検査する）。
 */
export function isRemoteToolAllowedFor(name: string, allowedActions: readonly string[]): boolean {
  if (!REMOTE_TOOL_SET.has(name)) return false
  if (WRITE_TOOL_SET.has(name)) return allowedActions.includes('write')
  return allowedActions.includes('read')
}
