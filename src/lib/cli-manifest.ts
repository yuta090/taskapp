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

export interface Manifest {
  version: string
  minCliVersion: string
  generatedAt: string
  checksum: string
  commands: ManifestCommand[]
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
        description: 'List tasks',
        aliases: ['ls'],
        tool: 'task_list',
        options: [
          spaceOpt,
          { flags: '--ball <side>', description: 'Filter: client|internal', param: 'ball', choices: ['client', 'internal'] },
          { flags: '--status <status>', description: 'Filter by status', param: 'status', choices: ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'considering'] },
          { flags: '--type <type>', description: 'Filter: task|spec', param: 'type', choices: ['task', 'spec'] },
          { flags: '--client-scope <scope>', description: 'Filter: deliverable|internal', param: 'clientScope', choices: ['deliverable', 'internal'] },
          { flags: '--limit <n>', description: 'Max results', param: 'limit', type: 'int', default: '50' },
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
        name: 'get',
        description: 'Get task details',
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
        description: 'List meetings',
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
        description: 'Get meeting details',
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
          { flags: '--entity-table <table>', description: 'Table name', param: 'entityTable', required: true },
          { flags: '--entity-id <uuid>', description: 'Entity ID', param: 'entityId', required: true },
          { flags: '--action <action>', description: 'Action', param: 'action', required: true },
          { flags: '--actor-type <type>', description: 'user|system|ai|service', param: 'actorType', choices: ['user', 'system', 'ai', 'service'], default: 'ai' },
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
        description: 'Create a client invite',
        tool: 'client_invite_create',
        options: [
          spaceOpt,
          { flags: '--email <email>', description: 'Client email', param: 'email', required: true },
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
        description: 'List client invites',
        tool: 'client_invite_list',
        options: [
          { flags: '-s, --space-id <uuid>', description: 'Filter by space', param: 'spaceId' },
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

  // ── Wiki ──
  {
    name: 'wiki',
    description: 'Wiki management',
    aliases: ['w'],
    subcommands: [
      {
        name: 'list',
        description: 'List wiki pages',
        aliases: ['ls'],
        tool: 'wiki_list',
        options: [
          spaceOpt,
          { flags: '--limit <n>', description: 'Max results', param: 'limit', type: 'int', default: '50' },
        ],
      },
      {
        name: 'get',
        description: 'Get wiki page details',
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
        options: [
          spaceOpt,
          { flags: '--title <title>', description: 'Page title', param: 'title', required: true },
          { flags: '--body <body>', description: 'Page body (Markdown)', param: 'body' },
          { flags: '--tags <tags...>', description: 'Tags', param: 'tags', type: 'string[]' },
        ],
      },
      {
        name: 'update',
        description: 'Update a wiki page',
        tool: 'wiki_update',
        options: [
          spaceOpt,
          { flags: '--page-id <id>', description: 'Wiki page ID', param: 'pageId', required: true },
          { flags: '--title <title>', description: 'New title', param: 'title' },
          { flags: '--body <body>', description: 'New body (Markdown)', param: 'body' },
          { flags: '--tags <tags...>', description: 'New tags', param: 'tags', type: 'string[]' },
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

function computeChecksum(commands: ManifestCommand[]): string {
  const hash = createHash('sha256').update(JSON.stringify(commands)).digest('hex')
  return `sha256:${hash}`
}

// Cache manifest to ensure stable ETag (generatedAt is fixed per version)
let _cached: Manifest | null = null

export function getManifest(): Manifest {
  if (!_cached) {
    _cached = {
      version: '1.0.0',
      minCliVersion: '0.2.0',
      generatedAt: '2026-03-07T00:00:00Z', // Fixed per version (not per-request)
      checksum: computeChecksum(MANIFEST_COMMANDS),
      commands: MANIFEST_COMMANDS,
    }
  }
  return _cached
}
