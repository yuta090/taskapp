import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

// UUID v4 format validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// CSV formula injection対策: これらの文字で始まるセルはExcel/Sheetsで実行される可能性
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r']

// デフォルトヘッダー設定
const DEFAULT_HEADERS: Record<string, string> = {
  id: 'ID',
  title: 'タイトル',
  description: '説明',
  type: 'タイプ',
  status: 'ステータス',
  priority: '優先度',
  due_date: '期限',
  ball: 'ボール',
  origin: '起案元',
  assignee: '担当者',
  milestone: 'マイルストーン',
  spec_path: '仕様パス',
  decision_state: '決定状態',
  created_at: '作成日時',
  updated_at: '更新日時',
}

const DEFAULT_COLUMNS = [
  'id', 'title', 'description', 'type', 'status', 'priority',
  'due_date', 'ball', 'origin', 'assignee', 'milestone',
  'spec_path', 'decision_state', 'created_at', 'updated_at'
]

// 日付をローカルタイムゾーンでYYYY-MM-DD形式に変換
function formatDateToLocalString(date: Date | string | null): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// 日時をローカルタイムゾーンでYYYY-MM-DD HH:mm形式に変換
function formatDateTimeToLocalString(date: Date | string | null): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

// CSVエスケープ（ダブルクォート、カンマ、改行、formula injection対策）
function escapeCSV(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  let str = String(value)

  // Formula injection対策: 先頭空白を除いた最初の文字が危険な場合はプレフィックス
  // " =1+1" のようなケースも防ぐ
  const trimmed = str.trimStart()
  if (trimmed.length > 0 && FORMULA_PREFIXES.some(prefix => trimmed.startsWith(prefix))) {
    str = "'" + str
  }

  // ダブルクォート、カンマ、改行を含む場合はクォートで囲む
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

// タスクデータから指定カラムの値を取得
function getTaskValue(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  task: any,
  column: string,
  profileMap: Map<string, string>,
  milestoneMap: Map<string, string>
): string {
  switch (column) {
    case 'id':
      return escapeCSV(task.id)
    case 'title':
      return escapeCSV(task.title)
    case 'description':
      return escapeCSV(task.description)
    case 'type':
      return escapeCSV(task.type)
    case 'status':
      return escapeCSV(task.status)
    case 'priority':
      return escapeCSV(task.priority?.toString())
    case 'due_date':
      return escapeCSV(formatDateToLocalString(task.due_date))
    case 'ball':
      return escapeCSV(task.ball)
    case 'origin':
      return escapeCSV(task.origin)
    case 'assignee':
      return escapeCSV(task.assignee_id ? profileMap.get(task.assignee_id) || '' : '')
    case 'milestone':
      return escapeCSV(task.milestone_id ? milestoneMap.get(task.milestone_id) || '' : '')
    case 'spec_path':
      return escapeCSV(task.spec_path)
    case 'decision_state':
      return escapeCSV(task.decision_state)
    case 'created_at':
      return escapeCSV(formatDateTimeToLocalString(task.created_at))
    case 'updated_at':
      return escapeCSV(formatDateTimeToLocalString(task.updated_at))
    default:
      return ''
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // 認証チェック
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // パラメータ取得
    const { searchParams } = new URL(request.url)
    const spaceId = searchParams.get('spaceId')
    const templateId = searchParams.get('templateId')
    const customHeaders = searchParams.get('headers') // JSON形式: {"id":"ID番号","title":"件名"}
    const customColumns = searchParams.get('columns') // カンマ区切り: id,title,status

    // バリデーション
    if (!spaceId || !UUID_REGEX.test(spaceId)) {
      return NextResponse.json(
        { error: 'Invalid or missing spaceId' },
        { status: 400 }
      )
    }

    // ユーザーが内部メンバー（owner/admin/member）か確認（clientロールは除外）
    const { data: membership } = await (supabase as SupabaseClient)
      .from('space_memberships')
      .select('id, role')
      .eq('user_id', user.id)
      .eq('space_id', spaceId)
      .neq('role', 'client')
      .single()

    if (!membership) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      )
    }

    // ヘッダー設定を決定
    let headers: Record<string, string> = { ...DEFAULT_HEADERS }
    let columns: string[] = [...DEFAULT_COLUMNS]

    // 1. テンプレートIDが指定された場合、DBから取得
    if (templateId) {
      if (!UUID_REGEX.test(templateId)) {
        return NextResponse.json(
          { error: 'Invalid templateId format' },
          { status: 400 }
        )
      }

      const { data: template } = await (supabase as SupabaseClient)
        .from('export_templates')
        .select('headers, columns')
        .eq('id', templateId)
        .eq('space_id', spaceId)
        .single()

      if (template) {
        headers = { ...DEFAULT_HEADERS, ...template.headers }
        // テンプレートのカラムも有効なカラムのみフィルタ
        const templateColumns = (template.columns || []).filter(
          (c: string) => DEFAULT_COLUMNS.includes(c)
        )
        columns = templateColumns.length > 0 ? templateColumns : DEFAULT_COLUMNS
      }
    }
    // 2. テンプレートIDがない場合、デフォルトテンプレートを探す
    else if (!customHeaders && !customColumns) {
      const { data: defaultTemplate } = await (supabase as SupabaseClient)
        .from('export_templates')
        .select('headers, columns')
        .eq('space_id', spaceId)
        .eq('is_default', true)
        .single()

      if (defaultTemplate) {
        headers = { ...DEFAULT_HEADERS, ...defaultTemplate.headers }
        const templateColumns = (defaultTemplate.columns || []).filter(
          (c: string) => DEFAULT_COLUMNS.includes(c)
        )
        columns = templateColumns.length > 0 ? templateColumns : DEFAULT_COLUMNS
      }
    }

    // 3. クエリパラメータでカスタマイズ（最優先）
    if (customHeaders) {
      try {
        const parsed = JSON.parse(customHeaders)
        headers = { ...headers, ...parsed }
      } catch {
        return NextResponse.json(
          { error: 'Invalid headers JSON format' },
          { status: 400 }
        )
      }
    }

    if (customColumns) {
      const parsed = customColumns.split(',').map(c => c.trim()).filter(c => c)
      if (parsed.length > 0) {
        // 有効なカラムのみフィルタ
        const validColumns = parsed.filter(c => DEFAULT_COLUMNS.includes(c))
        columns = validColumns.length > 0 ? validColumns : DEFAULT_COLUMNS
      }
    }

    // タスク取得
    const { data: tasks, error: tasksError } = await (supabase as SupabaseClient)
      .from('tasks')
      .select(`
        id,
        title,
        description,
        type,
        status,
        priority,
        due_date,
        ball,
        origin,
        spec_path,
        decision_state,
        created_at,
        updated_at,
        assignee_id,
        milestone_id
      `)
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false })

    if (tasksError) {
      console.error('Tasks fetch error:', tasksError)
      return NextResponse.json(
        { error: 'Failed to fetch tasks' },
        { status: 500 }
      )
    }

    // 担当者IDを収集（必要なプロファイルのみ取得）
    const assigneeIds = [...new Set(
      (tasks || [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((t: any) => t.assignee_id)
        .filter((id: string | null) => id !== null)
    )]

    // プロファイル取得（担当者名解決用、display_nameのみ使用しメール非公開）
    let profileMap = new Map<string, string>()
    if (assigneeIds.length > 0) {
      const { data: profiles } = await (supabase as SupabaseClient)
        .from('profiles')
        .select('id, display_name')
        .in('id', assigneeIds)

      profileMap = new Map<string, string>(
        (profiles || []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name || ''])
      )
    }

    // マイルストーン取得（名前解決用）
    const { data: milestones } = await (supabase as SupabaseClient)
      .from('milestones')
      .select('id, title')
      .eq('space_id', spaceId)

    const milestoneMap = new Map<string, string>(
      (milestones || []).map((m: { id: string; title: string }) => [m.id, m.title])
    )

    // スペース名取得（ファイル名用）
    const { data: space } = await (supabase as SupabaseClient)
      .from('spaces')
      .select('name')
      .eq('id', spaceId)
      .single()

    const spaceName = space?.name || 'tasks'

    // CSVヘッダー行生成
    const headerRow = columns.map(col => escapeCSV(headers[col] || col)).join(',')

    // CSV行生成
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (tasks || []).map((task: any) =>
      columns.map(col => getTaskValue(task, col, profileMap, milestoneMap)).join(',')
    )

    // CSV組み立て（BOM付きUTF-8）
    const BOM = '\uFEFF'
    const csv = BOM + headerRow + '\n' + rows.join('\n')

    // ファイル名生成
    const today = formatDateToLocalString(new Date())
    const filename = `${spaceName}_tasks_${today}.csv`

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  } catch (err) {
    console.error('Export error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
