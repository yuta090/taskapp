/**
 * CLI Dynamic Manifest - Server-side definition
 * Phase 1: TypeScript constant (updated via deploy)
 */
import { createHash } from 'crypto'

export interface ManifestOption {
  flags: string
  description?: string
  param: string
  required?: boolean
  default?: string
  type?: 'int' | 'float' | 'bool' | 'json' | 'string[]' | 'negatable'
  choices?: string[]
  resolve?: 'spaceId'
  dependsOn?: string
  conflictsWith?: string
}

export interface ManifestSubcommand {
  name: string
  description: string
  aliases?: string[]
  tool: string
  examples?: string[]
  deprecated?: boolean
  hidden?: boolean
  stdinMode?: boolean
  /** stdin の読み方。'json'(既定) / 'text'(生テキストを stdinParam に入れる。CSV取り込み等) */
  stdinFormat?: 'json' | 'text'
  /** stdinFormat='text' のとき、テキストを入れるパラメータ名 */
  stdinParam?: string
  /** ファイルアップロード(3段階)。CLI 0.4.0+ が tool→署名URLへPUT→completeTool の順に処理する */
  uploadMode?: boolean
  /** uploadMode=true のとき、完了を確定するツール名 */
  completeTool?: string
  options: ManifestOption[]
}

export interface ManifestCommand {
  name: string
  description: string
  aliases?: string[]
  tool?: string
  options?: ManifestOption[]
  subcommands?: ManifestSubcommand[]
}

/**
 * CLI に出す「お知らせ」。CLI 側はまだ見ていない id だけを 1 回表示して既読にする。
 * checksum の対象外(commands だけ)なので、旧 CLI(〜0.4.0)は項目ごと無視して動く。
 * 追加するときは id を一意に(日付-topic)、message は非技術者向けの一文で。
 */
export interface ManifestNotice {
  id: string
  date: string
  message: string
}

export interface Manifest {
  version: string
  minCliVersion: string
  generatedAt: string
  checksum: string
  commands: ManifestCommand[]
  notices: ManifestNotice[]
}

// Space ID option shared across most commands
const spaceOpt: ManifestOption = {
  flags: '-s, --space-id <uuid>',
  description: 'Space UUID',
  param: 'spaceId',
  resolve: 'spaceId',
}

const MANIFEST_COMMANDS: ManifestCommand[] = [
  // ── Task ──
  {
    name: 'task',
    description: 'Task management',
    aliases: ['t'],
    subcommands: [
      {
        name: 'list',
        description: 'List tasks. Each task includes number (TP-##) — put it in a PR title to auto-link the PR to the task. Includes link — the URL that opens it in the app; paste it into a wiki page or minutes to reference it.',
        aliases: ['ls'],
        tool: 'task_list',
        options: [
          spaceOpt,
          { flags: '--ball <side>', description: 'Filter: client|internal', param: 'ball', choices: ['client', 'internal'] },
          { flags: '--status <status>', description: 'Filter by status', param: 'status', choices: ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'considering'] },
          { flags: '--type <type>', description: 'Filter: task|spec', param: 'type', choices: ['task', 'spec'] },
          { flags: '--client-scope <scope>', description: 'Filter: deliverable|internal', param: 'clientScope', choices: ['deliverable', 'internal'] },
          { flags: '--limit <n>', description: 'Max results', param: 'limit', type: 'int', default: '50' },
          { flags: '--offset <n>', description: 'Skip the first n results (page with --limit: 0, 100, 200...)', param: 'offset', type: 'int', default: '0' },
        ],
      },
      {
        name: 'create',
        description: 'Create a task',
        tool: 'task_create',
        options: [
          spaceOpt,
          { flags: '--title <title>', description: 'Task title', param: 'title', required: true },
          { flags: '--description <desc>', description: 'Task description', param: 'description' },
          { flags: '--status <status>', description: 'Initial status (default: backlog / spec: considering)', param: 'status', choices: ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'considering'] },
          { flags: '--type <type>', description: 'task|spec', param: 'type', choices: ['task', 'spec'], default: 'task' },
          { flags: '--ball <side>', description: 'client|internal', param: 'ball', choices: ['client', 'internal'], default: 'internal' },
          { flags: '--origin <origin>', description: 'client|internal', param: 'origin', choices: ['client', 'internal'], default: 'internal' },
          { flags: '--client-scope <scope>', description: 'deliverable|internal', param: 'clientScope', choices: ['deliverable', 'internal'], default: 'deliverable' },
          { flags: '--client-owner-ids <ids...>', description: 'Client owner UUIDs', param: 'clientOwnerIds', type: 'string[]' },
          { flags: '--internal-owner-ids <ids...>', description: 'Internal owner UUIDs', param: 'internalOwnerIds', type: 'string[]' },
          { flags: '--due-date <date>', description: 'Due date (YYYY-MM-DD)', param: 'dueDate' },
          { flags: '--assignee-id <uuid>', description: 'Assignee UUID', param: 'assigneeId' },
          { flags: '--milestone-id <uuid>', description: 'Milestone UUID', param: 'milestoneId' },
          { flags: '--spec-path <path>', description: 'Spec path (required for type=spec)', param: 'specPath' },
          { flags: '--decision-state <state>', description: 'considering|decided|implemented', param: 'decisionState', choices: ['considering', 'decided', 'implemented'] },
        ],
      },
      {
        name: 'import',
        description: 'Import tasks from a CSV file (dry-run by default; add --no-dry-run to create)',
        tool: 'task_import',
        stdinMode: true,
        stdinFormat: 'text',
        stdinParam: 'csv',
        examples: [
          'agentpm task import --file tasks.csv',
          'agentpm task import --file tasks.csv --no-dry-run',
          'cat tasks.csv | agentpm task import --stdin --no-dry-run',
        ],
        options: [
          spaceOpt,
          { flags: '--stdin', description: 'Read CSV text from stdin (or use --file <path>)', param: 'stdin', type: 'bool' },
          { flags: '--no-dry-run', description: 'Actually create tasks (default: preview only)', param: 'dryRun', type: 'negatable' },
        ],
      },
      {
        name: 'get',
        description: 'Get task details. Includes number (TP-##) — put it in a PR title to auto-link the PR to the task. Includes link — the URL that opens it in the app; paste it into a wiki page or minutes to reference it.',
        tool: 'task_get',
        options: [
          spaceOpt,
          { flags: '--task-id <uuid>', description: 'Task UUID', param: 'taskId', required: true },
        ],
      },
      {
        name: 'update',
        description: 'Update a task',
        tool: 'task_update',
        options: [
          spaceOpt,
          { flags: '--task-id <uuid>', description: 'Task UUID', param: 'taskId', required: true },
          { flags: '--title <title>', description: 'New title', param: 'title' },
          { flags: '--description <desc>', description: 'New description', param: 'description' },
          { flags: '--status <status>', description: 'New status', param: 'status' },
          { flags: '--due-date <date>', description: 'New due date', param: 'dueDate' },
          { flags: '--assignee-id <uuid>', description: 'New assignee', param: 'assigneeId' },
          { flags: '--priority <n>', description: 'Priority (0-3)', param: 'priority', type: 'int' },
          { flags: '--client-scope <scope>', description: 'deliverable|internal', param: 'clientScope', choices: ['deliverable', 'internal'] },
          { flags: '--start-date <date>', description: 'Start date', param: 'startDate' },
          { flags: '--parent-task-id <uuid>', description: 'Parent task UUID', param: 'parentTaskId' },
          { flags: '--actual-hours <n>', description: 'Actual hours', param: 'actualHours', type: 'float' },
          { flags: '--milestone-id <uuid>', description: 'Milestone UUID', param: 'milestoneId' },
          { flags: '--wiki-page-id <uuid>', description: 'Link a wiki page (仕様書連携)', param: 'wikiPageId' },
          { flags: '--assignee-email <email>', description: 'Assign by email. Works for members and pending invites (handed over on accept)', param: 'assigneeEmail' },
          { flags: '--assignee-invite-id <uuid>', description: 'Assign a pending invite directly', param: 'assigneeInviteId' },
        ],
      },
      {
        name: 'delete',
        description: 'Delete a task (dry-run by default)',
        tool: 'task_delete',
        options: [
          spaceOpt,
          { flags: '--task-id <uuid>', description: 'Task UUID', param: 'taskId', required: true },
          { flags: '--no-dry-run', description: 'Actually delete (requires --confirm-token)', param: 'dryRun', type: 'negatable' },
          { flags: '--confirm-token <token>', description: 'Confirmation token from dry-run', param: 'confirmToken', dependsOn: 'no-dry-run' },
        ],
      },
      {
        name: 'list-my',
        description: 'List my tasks across all spaces',
        tool: 'task_list_my',
        options: [
          { flags: '--ball <side>', description: 'Filter: client|internal', param: 'ball', choices: ['client', 'internal'] },
          { flags: '--status <status>', description: 'Filter by status', param: 'status' },
          { flags: '--client-scope <scope>', description: 'Filter: deliverable|internal', param: 'clientScope', choices: ['deliverable', 'internal'] },
          { flags: '--limit <n>', description: 'Max results', param: 'limit', type: 'int', default: '50' },
          { flags: '--offset <n>', description: 'Skip the first n results (page with --limit: 0, 100, 200...)', param: 'offset', type: 'int', default: '0' },
        ],
      },
      {
        name: 'stale',
        description: 'Find stale tasks',
        tool: 'task_stale',
        options: [
          spaceOpt,
          { flags: '--stale-days <n>', description: 'Days threshold', param: 'staleDays', type: 'int', default: '7' },
          { flags: '--ball <side>', description: 'Filter: client|internal', param: 'ball', choices: ['client', 'internal'] },
          { flags: '--limit <n>', description: 'Max results', param: 'limit', type: 'int', default: '50' },
        ],
      },
    ],
  },

  // ── Ball ──
  {
    name: 'ball',
    description: 'Ball ownership management',
    aliases: ['b'],
    subcommands: [
      {
        name: 'pass',
        description: 'Pass ball ownership',
        tool: 'ball_pass',
        options: [
          spaceOpt,
          { flags: '--task-id <uuid>', description: 'Task UUID', param: 'taskId', required: true },
          { flags: '--ball <side>', description: 'New ball owner', param: 'ball', required: true, choices: ['client', 'internal'] },
          { flags: '--client-owner-ids <ids...>', description: 'Client owner UUIDs', param: 'clientOwnerIds', type: 'string[]' },
          { flags: '--internal-owner-ids <ids...>', description: 'Internal owner UUIDs', param: 'internalOwnerIds', type: 'string[]' },
          { flags: '--reason <reason>', description: 'Reason for passing', param: 'reason' },
        ],
      },
      {
        name: 'query',
        description: 'Query tasks by ball side',
        tool: 'ball_query',
        options: [
          spaceOpt,
          { flags: '--ball <side>', description: 'Ball side', param: 'ball', required: true, choices: ['client', 'internal'] },
          { flags: '--include-owners', description: 'Include owner info', param: 'includeOwners', type: 'bool' },
          { flags: '--limit <n>', description: 'Max results', param: 'limit', type: 'int', default: '50' },
        ],
      },
    ],
  },

  // ── Dashboard (top-level shortcut) ──
  {
    name: 'dashboard',
    description: 'Get project dashboard',
    aliases: ['dash'],
    tool: 'dashboard_get',
    options: [spaceOpt],
  },

  // ── Meeting ──
  {
    name: 'meeting',
    description: 'Meeting management',
    aliases: ['m'],
    subcommands: [
      {
        name: 'list',
        description: 'List meetings. Includes link — the URL that opens it in the app; paste it into a wiki page or minutes to reference it.',
        aliases: ['ls'],
        tool: 'meeting_list',
        options: [
          spaceOpt,
          { flags: '--status <status>', description: 'Filter: planned|in_progress|ended', param: 'status', choices: ['planned', 'in_progress', 'ended'] },
          { flags: '--limit <n>', description: 'Max results', param: 'limit', type: 'int', default: '20' },
        ],
      },
      {
        name: 'create',
        description: 'Create a meeting',
        tool: 'meeting_create',
        options: [
          spaceOpt,
          { flags: '--title <title>', description: 'Meeting title', param: 'title', required: true },
          { flags: '--held-at <datetime>', description: 'Date/time (ISO8601)', param: 'heldAt' },
          { flags: '--notes <notes>', description: 'Pre-meeting notes', param: 'notes' },
          { flags: '--participant-ids <ids...>', description: 'Participant UUIDs', param: 'participantIds', type: 'string[]' },
        ],
      },
      {
        name: 'start',
        description: 'Start a meeting',
        tool: 'meeting_start',
        options: [
          spaceOpt,
          { flags: '--meeting-id <uuid>', description: 'Meeting UUID', param: 'meetingId', required: true },
        ],
      },
      {
        name: 'end',
        description: 'End a meeting',
        tool: 'meeting_end',
        options: [
          spaceOpt,
          { flags: '--meeting-id <uuid>', description: 'Meeting UUID', param: 'meetingId', required: true },
        ],
      },
      {
        name: 'get',
        description: 'Get meeting details. Includes link — the URL that opens it in the app; paste it into a wiki page or minutes to reference it.',
        tool: 'meeting_get',
        options: [
          spaceOpt,
          { flags: '--meeting-id <uuid>', description: 'Meeting UUID', param: 'meetingId', required: true },
        ],
      },
    ],
  },

  // ── Review ──
  {
    name: 'review',
    description: 'Review management',
    aliases: ['r'],
    subcommands: [
      {
        name: 'list',
        description: 'List reviews',
        aliases: ['ls'],
        tool: 'review_list',
        options: [
          spaceOpt,
          { flags: '--status <status>', description: 'Filter: open|approved|changes_requested', param: 'status', choices: ['open', 'approved', 'changes_requested'] },
          { flags: '--limit <n>', description: 'Max results', param: 'limit', type: 'int', default: '20' },
        ],
      },
      {
        name: 'open',
        description: 'Open a review',
        tool: 'review_open',
        options: [
          spaceOpt,
          { flags: '--task-id <uuid>', description: 'Task UUID', param: 'taskId', required: true },
          { flags: '--reviewer-ids <ids...>', description: 'Reviewer UUIDs (1+)', param: 'reviewerIds', type: 'string[]', required: true },
        ],
      },
      {
        name: 'approve',
        description: 'Approve a review',
        tool: 'review_approve',
        options: [
          spaceOpt,
          { flags: '--task-id <uuid>', description: 'Task UUID', param: 'taskId', required: true },
        ],
      },
      {
        name: 'block',
        description: 'Block a review (request changes)',
        tool: 'review_block',
        options: [
          spaceOpt,
          { flags: '--task-id <uuid>', description: 'Task UUID', param: 'taskId', required: true },
          { flags: '--reason <reason>', description: 'Block reason', param: 'reason', required: true },
        ],
      },
      {
        name: 'get',
        description: 'Get review details with approvals',
        tool: 'review_get',
        options: [
          spaceOpt,
          { flags: '--task-id <uuid>', description: 'Task UUID', param: 'taskId', required: true },
        ],
      },
    ],
  },

  // ── Milestone ──
  {
    name: 'milestone',
    description: 'Milestone management',
    aliases: ['ms'],
    subcommands: [
      {
        name: 'list',
        description: 'List milestones',
        aliases: ['ls'],
        tool: 'milestone_list',
        options: [spaceOpt],
      },
      {
        name: 'create',
        description: 'Create a milestone',
        tool: 'milestone_create',
        options: [
          spaceOpt,
          { flags: '--name <name>', description: 'Milestone name', param: 'name', required: true },
          { flags: '--due-date <date>', description: 'Due date (YYYY-MM-DD)', param: 'dueDate' },
        ],
      },
      {
        name: 'update',
        description: 'Update a milestone',
        tool: 'milestone_update',
        options: [
          spaceOpt,
          { flags: '--milestone-id <uuid>', description: 'Milestone UUID', param: 'milestoneId', required: true },
          { flags: '--name <name>', description: 'New name', param: 'name' },
          { flags: '--due-date <date>', description: 'New due date', param: 'dueDate' },
          { flags: '--order-key <n>', description: 'Display order key', param: 'orderKey', type: 'int' },
        ],
      },
      {
        name: 'get',
        description: 'Get milestone details',
        tool: 'milestone_get',
        options: [
          spaceOpt,
          { flags: '--milestone-id <uuid>', description: 'Milestone UUID', param: 'milestoneId', required: true },
        ],
      },
      {
        name: 'delete',
        description: 'Delete a milestone',
        tool: 'milestone_delete',
        options: [
          spaceOpt,
          { flags: '--milestone-id <uuid>', description: 'Milestone UUID', param: 'milestoneId', required: true },
        ],
      },
    ],
  },

  // ── Space ──
  {
    name: 'space',
    description: 'Space/project management',
    aliases: ['sp'],
    subcommands: [
      {
        name: 'list',
        description: 'List spaces',
        aliases: ['ls'],
        tool: 'space_list',
        options: [
          { flags: '--type <type>', description: 'Filter: project|personal', param: 'type', choices: ['project', 'personal'] },
        ],
      },
      {
        name: 'create',
        description: 'Create a space',
        tool: 'space_create',
        options: [
          { flags: '--name <name>', description: 'Space name', param: 'name', required: true },
          { flags: '--type <type>', description: 'project|personal', param: 'type', choices: ['project', 'personal'], default: 'project' },
        ],
      },
      {
        name: 'update',
        description: 'Update a space',
        tool: 'space_update',
        options: [
          spaceOpt,
          { flags: '--name <name>', description: 'New name', param: 'name' },
        ],
      },
      {
        name: 'get',
        description: 'Get space details',
        tool: 'space_get',
        options: [spaceOpt],
      },
    ],
  },

  // ── Activity ──
  {
    name: 'activity',
    description: 'Activity log',
    aliases: ['act'],
    subcommands: [
      {
        name: 'search',
        description: 'Search activity logs',
        tool: 'activity_search',
        options: [
          spaceOpt,
          { flags: '--entity-table <table>', description: 'Filter by table name', param: 'entityTable' },
          { flags: '--entity-id <uuid>', description: 'Filter by entity ID', param: 'entityId' },
          { flags: '--actor-id <uuid>', description: 'Filter by actor ID', param: 'actorId' },
          { flags: '--action <action>', description: 'Filter by action', param: 'action' },
          { flags: '--from <datetime>', description: 'Start datetime (ISO8601)', param: 'from' },
          { flags: '--to <datetime>', description: 'End datetime (ISO8601)', param: 'to' },
          { flags: '--session-id <uuid>', description: 'Filter by session ID', param: 'sessionId' },
          { flags: '--limit <n>', description: 'Max results', param: 'limit', type: 'int', default: '100' },
        ],
      },
      {
        name: 'log',
        description: 'Create an activity log entry',
        tool: 'activity_log',
        options: [
          spaceOpt,
          { flags: '--entity-table <table>', description: 'Table name. Accepted: tasks, milestones, meetings, wiki_pages, reviews, task_comments, files, scheduling_proposals', param: 'entityTable', required: true },
          { flags: '--entity-id <uuid>', description: 'Entity ID', param: 'entityId', required: true },
          { flags: '--action <action>', description: 'Action', param: 'action', required: true },
          { flags: '--actor-type <type>', description: 'Always recorded as ai regardless of this value', param: 'actorType', choices: ['user', 'system', 'ai', 'service'], default: 'ai' },
          { flags: '--actor-service <service>', description: 'Service name', param: 'actorService' },
          { flags: '--entity-display <name>', description: 'Display name', param: 'entityDisplay' },
          { flags: '--reason <reason>', description: 'Reason', param: 'reason' },
          { flags: '--status <status>', description: 'ok|error|warning', param: 'status', choices: ['ok', 'error', 'warning'], default: 'ok' },
        ],
      },
      {
        name: 'history',
        description: 'Get entity change history',
        tool: 'activity_entity_history',
        options: [
          { flags: '--entity-table <table>', description: 'Table name', param: 'entityTable', required: true },
          { flags: '--entity-id <uuid>', description: 'Entity ID', param: 'entityId', required: true },
          { flags: '--limit <n>', description: 'Max results', param: 'limit', type: 'int', default: '50' },
        ],
      },
    ],
  },

  // ── Client ──
  {
    name: 'client',
    description: 'Client management',
    subcommands: [
      {
        name: 'list',
        description: 'List clients',
        aliases: ['ls'],
        tool: 'client_list',
        options: [
          { flags: '-s, --space-id <uuid>', description: 'Filter by space UUID', param: 'spaceId' },
          { flags: '--no-include-invites', description: 'Exclude pending invites', param: 'includeInvites', type: 'negatable' },
        ],
      },
      {
        name: 'get',
        description: 'Get client details',
        tool: 'client_get',
        options: [
          { flags: '--user-id <uuid>', description: 'Client user UUID', param: 'userId', required: true },
        ],
      },
      {
        name: 'update',
        description: 'Update client role in a space',
        tool: 'client_update',
        options: [
          { flags: '--user-id <uuid>', description: 'Client user UUID', param: 'userId', required: true },
          spaceOpt,
          { flags: '--role <role>', description: 'New role', param: 'role', required: true, choices: ['client', 'viewer'] },
        ],
      },
      {
        name: 'add-to-space',
        description: 'Add client to a space',
        tool: 'client_add_to_space',
        options: [
          { flags: '--user-id <uuid>', description: 'Client user UUID', param: 'userId', required: true },
          spaceOpt,
          { flags: '--role <role>', description: 'Role', param: 'role', choices: ['client', 'viewer'], default: 'client' },
        ],
      },
      {
        name: 'invite-create',
        description: 'Create an invite (client portal by default; --role member for internal)',
        tool: 'client_invite_create',
        options: [
          spaceOpt,
          { flags: '--email <email>', description: 'Invitee email', param: 'email', required: true },
          { flags: '--role <role>', description: 'client=portal / member=internal member', param: 'role', choices: ['client', 'member'], default: 'client' },
          { flags: '--expires-in-days <n>', description: 'Expiry days', param: 'expiresInDays', type: 'int', default: '7' },
        ],
      },
      {
        name: 'invite-bulk-create',
        description: 'Bulk create client invites',
        tool: 'client_invite_bulk_create',
        options: [
          spaceOpt,
          { flags: '--emails <emails...>', description: 'Client emails (max 50)', param: 'emails', type: 'string[]', required: true },
          { flags: '--expires-in-days <n>', description: 'Expiry days', param: 'expiresInDays', type: 'int', default: '7' },
        ],
      },
      {
        name: 'invite-list',
        description: 'List invites (client by default; --role member/all)',
        tool: 'client_invite_list',
        options: [
          { flags: '-s, --space-id <uuid>', description: 'Filter by space', param: 'spaceId' },
          { flags: '--role <role>', description: 'client / member / all', param: 'role', choices: ['client', 'member', 'all'], default: 'client' },
          { flags: '--status <status>', description: 'pending|accepted|expired|all', param: 'status', choices: ['pending', 'accepted', 'expired', 'all'], default: 'pending' },
        ],
      },
      {
        name: 'invite-resend',
        description: 'Resend a client invite',
        tool: 'client_invite_resend',
        options: [
          { flags: '--invite-id <uuid>', description: 'Invite UUID', param: 'inviteId', required: true },
          { flags: '--expires-in-days <n>', description: 'New expiry days', param: 'expiresInDays', type: 'int', default: '7' },
        ],
      },
    ],
  },

  // ── Invite（相手先・社内メンバー共通の入口。client グループの別名で、既定は社内メンバー） ──
  {
    name: 'invite',
    description: 'Invites (internal member / client portal)',
    subcommands: [
      {
        name: 'create',
        description: 'Invite someone. Default role is member (internal). Returns the invite link',
        tool: 'client_invite_create',
        examples: [
          'agentpm invite create --email tabata@example.co.jp',
          'agentpm invite create --email client@example.com --role client',
        ],
        options: [
          spaceOpt,
          { flags: '--email <email>', description: 'Invitee email', param: 'email', required: true },
          { flags: '--role <role>', description: 'member=internal member / client=portal', param: 'role', choices: ['member', 'client'], default: 'member' },
          { flags: '--expires-in-days <n>', description: 'Expiry days', param: 'expiresInDays', type: 'int', default: '7' },
        ],
      },
      {
        name: 'list',
        description: 'List invites (default: all roles, pending)',
        aliases: ['ls'],
        tool: 'client_invite_list',
        options: [
          { flags: '-s, --space-id <uuid>', description: 'Filter by space', param: 'spaceId' },
          { flags: '--role <role>', description: 'member / client / all', param: 'role', choices: ['member', 'client', 'all'], default: 'all' },
          { flags: '--status <status>', description: 'pending|accepted|expired|all', param: 'status', choices: ['pending', 'accepted', 'expired', 'all'], default: 'pending' },
        ],
      },
      {
        name: 'resend',
        description: 'Extend an invite expiry and get the link again',
        tool: 'client_invite_resend',
        options: [
          { flags: '--invite-id <uuid>', description: 'Invite UUID', param: 'inviteId', required: true },
          { flags: '--expires-in-days <n>', description: 'New expiry days', param: 'expiresInDays', type: 'int', default: '7' },
        ],
      },
    ],
  },

  // ── Wiki ──
  {
    name: 'file',
    description: 'Project files (upload / list / describe)',
    aliases: ['f'],
    subcommands: [
      {
        name: 'list',
        description: 'List uploaded files in the space (ready only, newest first). Includes link — the download URL; paste it into a wiki page or minutes to reference the file.',
        tool: 'file_list',
        examples: ['agentpm file list', 'agentpm file list --limit 100 --json'],
        options: [
          spaceOpt,
          { flags: '-l, --limit <n>', description: 'Max results (default 50)', param: 'limit', type: 'int', default: '50' },
        ],
      },
      {
        name: 'upload',
        description: 'Upload a local file to the space. CSV/TSV can then be viewed as a table in TaskApp',
        tool: 'file_upload_url',
        // CLI(0.4.0+) が 3 段階（署名URL → PUT → 完了）で処理する。旧 CLI は uploadMode を知らず
        // file_upload_url を直接呼んで失敗する（このコマンドのみ。他コマンドには影響しない）
        uploadMode: true,
        completeTool: 'file_upload_complete',
        examples: [
          'agentpm file upload --file ./list.csv',
          'agentpm file upload --file ./spec.pdf --name 要件定義.pdf',
          'agentpm file upload -s <space-uuid> --file ./data.tsv --json',
        ],
        options: [
          spaceOpt,
          { flags: '-f, --file <path>', description: 'Local file path (up to 50MB)', param: 'file', required: true },
          { flags: '--name <name>', description: 'File name shown in TaskApp (default: local file name)', param: 'name' },
          { flags: '--mime-type <type>', description: 'MIME type (default: guessed from extension)', param: 'mimeType' },
        ],
      },
      {
        name: 'update',
        description: 'Set a file description (what the file is) or rename it',
        tool: 'file_update',
        examples: [
          'agentpm file update --file-id <uuid> --description "顧客管理表 v1（列定義は Wiki 11）"',
          'agentpm file update --file-id <uuid> --description ""   # 説明を消す',
        ],
        options: [
          spaceOpt,
          { flags: '--file-id <uuid>', description: 'File UUID (see: agentpm file list)', param: 'fileId', required: true },
          { flags: '--description <text>', description: 'Description (what the file is, up to 1000 chars). Empty string clears it', param: 'description' },
          { flags: '--name <name>', description: 'New display name', param: 'name' },
        ],
      },
    ],
  },
  {
    name: 'wiki',
    description: 'Wiki management',
    aliases: ['w'],
    subcommands: [
      {
        name: 'list',
        description: 'List wiki pages. Includes link — the URL that opens it in the app; paste it into a wiki page or minutes to reference it.',
        aliases: ['ls'],
        tool: 'wiki_list',
        options: [
          spaceOpt,
          { flags: '--limit <n>', description: 'Max results', param: 'limit', type: 'int', default: '50' },
        ],
      },
      {
        name: 'get',
        description: 'Get wiki page details. Includes link — the URL that opens it in the app; paste it into a wiki page or minutes to reference it.',
        tool: 'wiki_get',
        options: [
          spaceOpt,
          { flags: '--page-id <id>', description: 'Wiki page ID', param: 'pageId', required: true },
        ],
      },
      {
        name: 'create',
        description: 'Create a wiki page',
        tool: 'wiki_create',
        stdinMode: true,
        stdinFormat: 'text',
        stdinParam: 'body',
        examples: [
          'agentpm wiki create --title "顧客ジャーニー" --file 14_customer_journey_v1.md --tags 仕様書',
          'agentpm wiki create --title "ターゲット分類" --file 04_target_segmentation_v0.html',
          'agentpm wiki create --title "メモ" --body "# 見出し"',
        ],
        options: [
          spaceOpt,
          { flags: '--title <title>', description: 'Page title', param: 'title', required: true },
          { flags: '--body <body>', description: 'Page body (Markdown / HTML). Or use --file <path> / --stdin', param: 'body' },
          { flags: '--stdin', description: 'Read body text from stdin', param: 'stdin', type: 'bool' },
          { flags: '--format <fmt>', description: 'Body format (default: auto-detect)', param: 'format', choices: ['markdown', 'html', 'blocks'] },
          { flags: '--tags <tags...>', description: 'Tags（仕様書 を付けるとタスクの「仕様書連携」で選べる）', param: 'tags', type: 'string[]' },
        ],
      },
      {
        name: 'update',
        description: 'Update a wiki page',
        tool: 'wiki_update',
        stdinMode: true,
        stdinFormat: 'text',
        stdinParam: 'body',
        examples: ['agentpm wiki update --page-id <id> --file 14_customer_journey_v2.md'],
        options: [
          spaceOpt,
          { flags: '--page-id <id>', description: 'Wiki page ID', param: 'pageId', required: true },
          { flags: '--title <title>', description: 'New title', param: 'title' },
          { flags: '--body <body>', description: 'New body (Markdown / HTML). Or use --file <path> / --stdin', param: 'body' },
          { flags: '--stdin', description: 'Read body text from stdin', param: 'stdin', type: 'bool' },
          { flags: '--format <fmt>', description: 'Body format (default: auto-detect)', param: 'format', choices: ['markdown', 'html', 'blocks'] },
          { flags: '--tags <tags...>', description: 'New tags', param: 'tags', type: 'string[]' },
          { flags: '--parent-page-id <id>', description: 'Parent page (folder). Use "none" to move to the root', param: 'parentPageId' },
          { flags: '--milestone-id <id>', description: 'Link to a milestone. Use "none" to unlink', param: 'milestoneId' },
          { flags: '--pinned', description: 'Pin to the top of the list', param: 'pinned', type: 'bool' },
          { flags: '--no-pinned', description: 'Unpin', param: 'pinned', type: 'negatable' },
        ],
      },
      {
        name: 'delete',
        description: 'Delete a wiki page',
        tool: 'wiki_delete',
        options: [
          spaceOpt,
          { flags: '--page-id <id>', description: 'Wiki page ID', param: 'pageId', required: true },
        ],
      },
      {
        name: 'versions',
        description: 'Get wiki page version history',
        tool: 'wiki_versions',
        options: [
          spaceOpt,
          { flags: '--page-id <id>', description: 'Wiki page ID', param: 'pageId', required: true },
          { flags: '--limit <n>', description: 'Max results', param: 'limit', type: 'int', default: '20' },
        ],
      },
    ],
  },

  // ── Minutes ──
  {
    name: 'minutes',
    description: 'Meeting minutes',
    aliases: ['min'],
    subcommands: [
      {
        name: 'get',
        description: 'Get meeting minutes',
        tool: 'minutes_get',
        options: [
          spaceOpt,
          { flags: '--meeting-id <id>', description: 'Meeting ID', param: 'meetingId', required: true },
        ],
      },
      {
        name: 'update',
        description: 'Update meeting minutes (overwrite)',
        tool: 'minutes_update',
        options: [
          spaceOpt,
          { flags: '--meeting-id <id>', description: 'Meeting ID', param: 'meetingId', required: true },
          { flags: '--minutes-md <md>', description: 'Minutes content (Markdown)', param: 'minutesMd', required: true },
        ],
      },
      {
        name: 'append',
        description: 'Append to meeting minutes',
        tool: 'minutes_append',
        options: [
          spaceOpt,
          { flags: '--meeting-id <id>', description: 'Meeting ID', param: 'meetingId', required: true },
          { flags: '--content <md>', description: 'Content to append (Markdown)', param: 'content', required: true },
        ],
      },
    ],
  },

  // ── Scheduling ──
  {
    name: 'scheduling',
    description: 'Scheduling management',
    aliases: ['sch'],
    subcommands: [
      {
        name: 'list',
        description: 'List scheduling proposals',
        aliases: ['ls'],
        tool: 'list_scheduling_proposals',
        options: [
          spaceOpt,
          { flags: '--status <status>', description: 'Filter: open|confirmed|cancelled|expired', param: 'status', choices: ['open', 'confirmed', 'cancelled', 'expired'] },
          { flags: '--limit <n>', description: 'Max results', param: 'limit', type: 'int', default: '50' },
        ],
      },
      {
        name: 'create',
        description: 'Create a scheduling proposal (use --stdin for complex input)',
        tool: 'create_scheduling_proposal',
        stdinMode: true,
        options: [
          spaceOpt,
          { flags: '--stdin', description: 'Read JSON params from stdin', param: 'stdin', type: 'bool' },
        ],
      },
      {
        name: 'respond',
        description: 'Respond to a scheduling proposal (use --stdin)',
        tool: 'respond_to_proposal',
        stdinMode: true,
        options: [
          spaceOpt,
          { flags: '--proposal-id <uuid>', description: 'Proposal UUID', param: 'proposalId', required: true },
          { flags: '--stdin', description: 'Read JSON params from stdin', param: 'stdin', type: 'bool' },
        ],
      },
      {
        name: 'confirm',
        description: 'Confirm a scheduling slot',
        tool: 'confirm_proposal_slot',
        options: [
          spaceOpt,
          { flags: '--proposal-id <uuid>', description: 'Proposal UUID', param: 'proposalId', required: true },
          { flags: '--slot-id <uuid>', description: 'Slot UUID to confirm', param: 'slotId', required: true },
        ],
      },
      {
        name: 'cancel',
        description: 'Cancel or extend a proposal',
        tool: 'cancel_scheduling_proposal',
        options: [
          spaceOpt,
          { flags: '--proposal-id <uuid>', description: 'Proposal UUID', param: 'proposalId', required: true },
          { flags: '--action <action>', description: 'cancel|extend', param: 'action', required: true, choices: ['cancel', 'extend'] },
          { flags: '--new-expires-at <datetime>', description: 'New expiry (ISO8601, for extend)', param: 'newExpiresAt' },
        ],
      },
      {
        name: 'responses',
        description: 'Get proposal response status',
        tool: 'get_proposal_responses',
        options: [
          spaceOpt,
          { flags: '--proposal-id <uuid>', description: 'Proposal UUID', param: 'proposalId', required: true },
        ],
      },
      {
        name: 'suggest',
        description: 'Suggest available time slots from Google Calendar',
        tool: 'suggest_available_slots',
        options: [
          spaceOpt,
          { flags: '--user-ids <ids...>', description: 'User UUIDs to check', param: 'userIds', type: 'string[]', required: true },
          { flags: '--start-date <date>', description: 'Start date (YYYY-MM-DD)', param: 'startDate', required: true },
          { flags: '--end-date <date>', description: 'End date (YYYY-MM-DD)', param: 'endDate', required: true },
          { flags: '--duration-minutes <n>', description: 'Duration in minutes', param: 'durationMinutes', type: 'int', default: '60' },
          { flags: '--business-hour-start <n>', description: 'Business start hour', param: 'businessHourStart', type: 'int', default: '9' },
          { flags: '--business-hour-end <n>', description: 'Business end hour', param: 'businessHourEnd', type: 'int', default: '18' },
        ],
      },
      {
        name: 'reminder',
        description: 'Send reminder to unresponded users',
        tool: 'send_proposal_reminder',
        options: [
          spaceOpt,
          { flags: '--proposal-id <uuid>', description: 'Proposal UUID', param: 'proposalId', required: true },
        ],
      },
    ],
  },
]

export const MANIFEST_NOTICES: ManifestNotice[] = [
  {
    id: '2026-09-07-file-upload',
    date: '2026-09-07',
    message: 'ファイルを CLI からアップロードできるようになりました: agentpm file upload --file <path>（50MB まで・CSV は TaskApp で表として見られます）',
  },
  {
    id: '2026-09-07-file-jp-name',
    date: '2026-09-07',
    message: '日本語の名前のファイルがアップロードで失敗していた不具合を直しました（画面・CLI とも）。以前失敗したファイルは、そのまま上げ直せます',
  },
  {
    id: '2026-09-08-task-create-status',
    date: '2026-09-08',
    message: 'タスクを作るときに最初のステータスを指定できるようになりました: agentpm task create --title "..." --status in_progress（省略すると今までどおり未着手）',
  },
  {
    id: '2026-09-08-wiki-update-structure',
    date: '2026-09-08',
    message: 'Wiki の並べ方を CLI からも変えられるようになりました: agentpm wiki update --page-id <id> --parent-page-id <親のID> / --milestone-id <ID> / --pinned（外すときは none・--no-pinned）',
  },
  {
    id: '2026-09-10-task-list-offset',
    date: '2026-09-10',
    message: 'タスク一覧を続きから取れるようになりました: agentpm task list --limit 100 --offset 100（101件目から）',
  },
  {
    id: '2026-09-13-app-links',
    date: '2026-09-13',
    message: 'タスク・Wikiページ・議事録・ファイルの一覧と詳細に link（画面で開くURL）が入るようになりました。Wiki や議事録の本文に [名前](link) の形で貼ると、そのまま開けます。画面側の「リンクを挿入」と同じ形です',
  },
  {
    id: '2026-09-13-task-description-links',
    date: '2026-09-13',
    message: 'タスクの説明文に書いた URL が押せるようになりました。link の値をそのまま書いてください（説明文はただの文字なので [名前](link) の形にはしない）: agentpm task update --task-id <id> --description "仕様は /<org>/project/<space>/wiki?page=<id> を参照"',
  },
]

function computeChecksum(commands: ManifestCommand[]): string {
  const hash = createHash('sha256').update(JSON.stringify(commands)).digest('hex')
  return `sha256:${hash}`
}

// Cache manifest to ensure stable ETag (generatedAt is fixed per version)
let _cached: Manifest | null = null

export function getManifest(): Manifest {
  if (!_cached) {
    _cached = {
      version: '1.10.0',
      minCliVersion: '0.2.0',
      generatedAt: '2026-09-10T14:00:00Z', // Fixed per version (not per-request)
      checksum: computeChecksum(MANIFEST_COMMANDS),
      commands: MANIFEST_COMMANDS,
      notices: MANIFEST_NOTICES,
    }
  }
  return _cached
}
