# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TaskApp is a client-facing project management system with "ball ownership" concept (who needs to act next). Built with Next.js 16 (App Router) + Supabase.

## Commands

```bash
npm run dev      # Start development server
npm run build    # Production build
npm run lint     # Run ESLint
```

## Specifications

**See `docs/SPEC_INDEX.md` for the complete specification index.**

### Current Versions

| Spec | Version | Path |
|------|---------|------|
| API | v0.4 | `docs/api/API_SPEC_v0.4.md` |
| DDL | v0.3〜v0.6 | `docs/db/DDL_v0.3.sql` 〜 `DDL_v0.6_subtasks.sql` |
| UI Rules | current | `docs/spec/UI_RULES_AND_SCREENS.md` |
| Review Spec | current | `docs/spec/REVIEW_SPEC.md` |
| MCP Governance | v1.0 | `docs/spec/MCP_TOOL_GOVERNANCE.md` |
| Subtask | v1.0 | `docs/spec/SUBTASK_HIERARCHY_SPEC.md` |

## UI Rules (Violations = Bugs)

- **3-pane fixed layout**: [Left Nav: 240px] - [Main: flex-1] - [Inspector: 400px]
- **Inspector never overlays** - must resize Main pane
- **Amber-500** indicates client-visible elements
- **Optimistic updates** required - no save buttons
- **No modal dialogs** for task details

## Data Model

```
ball = 'client' | 'internal'     # who needs to act next
origin = 'client' | 'internal'   # who initiated
type = 'task' | 'spec'           # spec requires spec_path + decision_state
```

## Key Files

```
src/
├── app/
│   ├── (internal)/[orgId]/project/[spaceId]/  # Tasks, Meetings
│   │   └── views/
│   │       ├── gantt/                         # ガントチャート
│   │       └── burndown/                      # バーンダウンチャート
│   ├── api/burndown/route.ts                  # バーンダウン集計API
│   └── portal/[token]/                        # Client portal
├── components/
│   ├── task/          # TaskRow, TaskInspector, TaskCreateSheet
│   ├── meeting/       # MeetingRow, MeetingInspector
│   ├── notification/  # NotificationInspector (タイプ別アクションパネル)
│   ├── burndown/      # BurndownChart, BurndownControls, BurndownTooltip
│   └── shared/        # ViewsTabNav (Gantt↔Burndown切替)
├── lib/
│   ├── supabase/rpc.ts    # RPC wrappers
│   ├── hooks/             # useTasks, useMeetings, useBurndown, etc.
│   ├── notifications/     # classify.ts (通知分類), types.ts
│   ├── burndown/          # computeBurndown (集計ロジック), constants
│   └── minutes-parser.ts  # AT-005 議事録パーサー
└── types/database.ts      # Type definitions
```

## Date Handling (重要)

**`toISOString()` は使用禁止** - UTC変換により日本時間で1日ずれる

```typescript
// NG: タイムゾーンずれ
const dateStr = date.toISOString().split('T')[0]

// OK: ローカルタイムゾーン維持
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'
const dateStr = formatDateToLocalString(date)
```

## Environment Setup

```bash
cp .env.local.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
```

## Implementation Status

AT-001〜AT-012: **全て実装済み** (詳細は `docs/SPEC_INDEX.md` 参照)
