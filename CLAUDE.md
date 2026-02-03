# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TaskApp is a client-facing project management system with "ball ownership" concept (who needs to act next). The application is built with Next.js 16 (App Router) and designed to connect to Supabase.

## Commands

```bash
npm run dev      # Start development server
npm run build    # Production build
npm run lint     # Run ESLint
```

## Project Structure

```
src/
├── app/
│   ├── (internal)/              # Internal user routes
│   │   ├── inbox/               # Notification inbox
│   │   ├── my/                  # My tasks
│   │   └── [orgId]/project/[spaceId]/
│   │       ├── page.tsx         # Tasks list
│   │       └── meetings/        # Meetings list
│   └── portal/[token]/          # Client portal (public)
├── components/
│   ├── layout/                  # AppShell, LeftNav (3-pane)
│   ├── task/                    # TaskRow, TaskInspector, TaskCreateSheet
│   ├── meeting/                 # MeetingRow, MeetingInspector
│   ├── review/                  # ReviewList, ReviewInspector
│   └── shared/                  # AmberBadge, AmberDot
├── lib/
│   ├── supabase/                # Client, server, RPC wrappers
│   └── hooks/                   # useTasks, useMeetings, useReviews, etc.
└── types/
    └── database.ts              # DDL v0.2 types

supabase/
└── migrations/
    └── 20240201_001_rpc_functions.sql  # RPC function definitions

docs/
├── spec/                        # UI rules, review spec
├── api/                         # API specs (v0.3)
├── db/                          # DDL (v0.2)
└── prototypes/                  # HTML prototypes (v29)
```

## Key Specifications

| File | Purpose |
|------|---------|
| `docs/spec/UI_RULES_AND_SCREENS.md` | UI rules (3-pane, Amber-500, no modals) |
| `docs/api/API_SPEC_v0.3.md` | RPC specifications |
| `docs/db/DDL_v0.2.sql` | Database schema |
| `docs/spec/REVIEW_SPEC.md` | Acceptance tests (AT-001~AT-012) |

## UI Rules (Violations = Bugs)

- **3-pane fixed layout**: [Left Nav: 240px] - [Main: flex-1] - [Inspector: 400px]
- **Inspector never overlays** - must resize Main pane
- **Amber-500** indicates client-visible elements
- **Optimistic updates** required - no save buttons
- **No modal dialogs** for task details
- Edit UI limited to: Inspector, Inline Popover, Create Sheet

## Data Model

- **Ball ownership**: `ball=client|internal` - who needs to act next
- **Origin tracking**: `origin=client|internal` - who initiated
- **Task types**: `type=task|spec` - spec requires `spec_path` and `decision_state`
- **Audit separation**: `actor_id` (who entered) vs `payload.on_behalf_of` (whose decision)

## RPC Functions

Located in `supabase/migrations/20240201_001_rpc_functions.sql`:

| RPC | Purpose |
|-----|---------|
| `rpc_pass_ball` | Ball ownership transfer with audit log |
| `rpc_decide_considering` | Resolve "considering" items with evidence |
| `rpc_set_spec_state` | Spec task state transitions |
| `rpc_review_open/approve/block` | Review workflow |
| `rpc_meeting_start/end` | Meeting lifecycle |
| `rpc_generate_meeting_minutes` | Meeting summary generation |

Frontend wrappers: `src/lib/supabase/rpc.ts`

## Hooks

```typescript
import { useTasks, useMeetings, useReviews, useConsidering, useSpecTasks } from '@/lib/hooks'

// Example usage
const { tasks, fetchTasks, passBall } = useTasks({ spaceId })
const { meetings, startMeeting, endMeeting } = useMeetings({ spaceId })
```

## Acceptance Tests (AT-001~AT-012)

Key validations implemented:
- AT-007: Client decisions outside meetings require `clientConfirmedBy`
- AT-008: Actor vs on_behalf_of separation in audit logs
- AT-009: spec_path required for decided/implemented spec tasks
- AT-010: Client dashboard prioritizes ball=client tasks
- AT-012: DB constraints enforce spec task requirements

## Date Handling (重要)

**`toISOString()` は使用禁止** - UTC変換により日本時間で1日ずれる

```typescript
// NG: タイムゾーンずれが発生
const dateStr = date.toISOString().split('T')[0]
// 日本時間 2024-02-15 00:00 → UTC 2024-02-14T15:00:00Z → "2024-02-14" (1日ずれ)

// OK: ローカルタイムゾーンを維持
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'
const dateStr = formatDateToLocalString(date)  // → "2024-02-15"
```

日付を `YYYY-MM-DD` 文字列に変換する際は必ず `formatDateToLocalString()` を使用すること。

## Environment Setup

Copy `.env.local.example` to `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Apply DDL to Supabase:
1. `docs/db/DDL_v0.2.sql` - Schema
2. `supabase/migrations/20240201_001_rpc_functions.sql` - RPC functions
