export const ALLOWED_TABLES = [
  'profiles',
  'organizations',
  'org_memberships',
  'org_billing',
  'plans',
  'spaces',
  'space_groups',
  'space_memberships',
  'invites',
  'tasks',
  'task_owners',
  'task_events',
  'task_comments',
  'milestones',
  'meetings',
  'meeting_participants',
  'reviews',
  'review_approvals',
  'notifications',
  'audit_logs',
  'wiki_pages',
  'wiki_page_versions',
  'wiki_page_publications',
  'api_keys',
  'scheduling_proposals',
  'proposal_slots',
  'proposal_respondents',
  'slot_responses',
] as const

export type AllowedTable = typeof ALLOWED_TABLES[number]

export function isAllowedTable(name: string): name is AllowedTable {
  return (ALLOWED_TABLES as readonly string[]).includes(name)
}

export const TABLE_LABELS: Record<AllowedTable, string> = {
  profiles: 'プロフィール',
  organizations: '組織',
  org_memberships: '組織メンバーシップ',
  org_billing: '課金',
  plans: 'プラン',
  spaces: 'スペース',
  space_groups: 'スペースグループ',
  space_memberships: 'スペースメンバーシップ',
  invites: '招待',
  tasks: 'タスク',
  task_owners: 'タスクオーナー',
  task_events: 'タスクイベント',
  task_comments: 'タスクコメント',
  milestones: 'マイルストーン',
  meetings: 'ミーティング',
  meeting_participants: 'ミーティング参加者',
  reviews: 'レビュー',
  review_approvals: 'レビュー承認',
  notifications: '通知',
  audit_logs: '監査ログ',
  wiki_pages: 'Wiki ページ',
  wiki_page_versions: 'Wiki バージョン',
  wiki_page_publications: 'Wiki 公開',
  api_keys: 'API キー',
  scheduling_proposals: 'スケジュール提案',
  proposal_slots: '提案スロット',
  proposal_respondents: '提案回答者',
  slot_responses: 'スロット回答',
}

export const TABLE_CATEGORIES: { label: string; tables: AllowedTable[] }[] = [
  {
    label: 'ユーザー・組織',
    tables: ['profiles', 'organizations', 'org_memberships', 'org_billing', 'plans'],
  },
  {
    label: 'スペース',
    tables: ['spaces', 'space_groups', 'space_memberships', 'invites'],
  },
  {
    label: 'タスク',
    tables: ['tasks', 'task_owners', 'task_events', 'task_comments', 'milestones'],
  },
  {
    label: 'ミーティング',
    tables: ['meetings', 'meeting_participants'],
  },
  {
    label: 'レビュー',
    tables: ['reviews', 'review_approvals'],
  },
  {
    label: 'その他',
    tables: ['notifications', 'audit_logs', 'wiki_pages', 'wiki_page_versions', 'wiki_page_publications', 'api_keys', 'scheduling_proposals', 'proposal_slots', 'proposal_respondents', 'slot_responses'],
  },
]
