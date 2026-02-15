# TaskApp Specification Index

> **Last Updated**: 2026-02-15
> **Status**: Production Ready (AT-001〜AT-012 実装済み、スケジューリング機能 Phase 1-4 完了)

このファイルは現行仕様の一覧です。古いバージョンは `docs/archive/` を参照。

---

## Current Specifications

### Core Specs

| Document | Version | Path | Description |
|----------|---------|------|-------------|
| **API Spec** | v0.4 | `api/API_SPEC_v0.4.md` | RPC・認証・招待・課金API |
| **DDL** | v0.3 + v0.4 | `db/DDL_v0.3.sql` + `db/DDL_v0.4_comments.sql` | DBスキーマ（v0.4はコメント機能追加） |
| **UI Rules** | current | `spec/UI_RULES_AND_SCREENS.md` | 3ペイン、Amber-500、UIルール |
| **Review Spec** | current | `spec/REVIEW_SPEC.md` | 受け入れテスト AT-001〜AT-012 |
| **Decisions** | v5 | `notes/DECISIONS_v5.md` | 設計判断の記録 |

### Feature Specs

| Document | Path | Description |
|----------|------|-------------|
| **Auth/Invite/Billing** | `spec/AUTH_INVITE_BILLING_SPEC.md` | 認証・招待・課金仕様 |
| **Assignee/Owner** | `spec/ASSIGNEE_OWNER_SPEC.md` | 担当者・オーナー仕様 |
| **Scheduling** | `spec/SCHEDULING_SPEC.md` | 日程調整・ビデオ会議・Google Calendar連携 (Phase 1-4) |
| **Native App Migration** | `spec/NATIVE_APP_MIGRATION_SPEC.md` | モノレポ移行・React Native (Expo) ネイティブアプリ仕様 |

### Prototypes

| Document | Path | Description |
|----------|------|-------------|
| **v29 (Base)** | `prototypes/TaskApp_MasterPrototype_v29.html` | 最新ベースプロトタイプ |
| **v29 Variants** | `prototypes/TaskApp_MasterPrototype_v29_*.html` | 機能別バリアント |

### Templates

| Document | Path | Description |
|----------|------|-------------|
| **Meeting Minutes** | `spec/MEETING_MINUTES_TEMPLATE.md` | 議事録テンプレート |
| **Review Spec Template** | `spec/REVIEW_SPEC_TEMPLATE.md` | レビュー仕様テンプレート |
| **UI Rules Template** | `spec/UI_RULES_AND_SCREENS_TEMPLATE.md` | UI仕様テンプレート |

---

## Implementation Status

### Completed (実装済み)

| AT | Feature | Status |
|----|---------|--------|
| AT-001 | 会議作成（参加者必須） | ✅ |
| AT-002 | 会議開始前は決定不可 | ✅ |
| AT-003 | 会議終了通知（冪等） | ✅ |
| AT-004 | 会議終了通知内容 | ✅ |
| AT-005 | 議事録パーサー | ✅ |
| AT-006 | 会議内SPEC決定ログ | ✅ |
| AT-007 | 会議外クライアント確定 | ✅ |
| AT-008 | 入力者/意思決定者分離 | ✅ |
| AT-009 | decided→implemented導線 | ✅ |
| AT-010 | クライアントダッシュボード | ✅ |
| AT-011 | 通知受信者ロジック | ✅ |
| AT-012 | DB制約（SPECタスク） | ✅ |

### Performance Optimization

| Document | Path | Description |
|----------|------|-------------|
| **最適化計画** | `PERFORMANCE_OPTIMIZATION_PLAN.md` | Claude×Codex分析に基づく4フェーズ最適化 (Phase 1-4 完了) |

### Scheduling (スケジューリング機能)

| Phase | Feature | Status |
|-------|---------|--------|
| Phase 1 | コア日程調整 (提案・回答・確定) | ✅ |
| Phase 2 | Google Calendar連携 (FreeBusy + OAuth) | ✅ |
| Phase 3 | ビデオ会議連携 (Google Meet / Zoom / Teams) | ✅ |
| Phase 4 | Realtime + pg_cron リマインダー + 期限切れ自動処理 | ✅ |

### Native App (ネイティブアプリ)

| Phase | Feature | Status |
|-------|---------|--------|
| Phase 0 | モノレポ基盤 (Turborepo + pnpm) | 計画中 |
| Phase 1 | 共有パッケージ切り出し (@taskapp/shared) | 計画中 |
| Phase 2 | Mobile アプリ基盤 (Expo + 認証 + タスク一覧) | 計画中 |
| Phase 3 | 機能拡充 (会議・通知・日程調整) | 計画中 |
| Phase 4 | ストア申請 (TestFlight / Play Console) | 計画中 |

### Planned (計画中)

| Feature | Priority | Notes |
|---------|----------|-------|
| GitHub連携 | Medium | Issue/PR自動リンク |
| Stripe課金 | Medium | Pro/Enterpriseプラン |
| MCP Server | Low | Claude Code連携 |

---

## Quick Reference

### Data Model Core Concepts

```
ball = 'client' | 'internal'     # 誰がボールを持っているか
origin = 'client' | 'internal'   # 誰が起票したか
type = 'task' | 'spec'           # 仕様タスクかどうか
decision_state = 'considering' | 'decided' | 'implemented'
```

### UI Rules (違反=バグ)

- **3ペイン固定**: [LeftNav: 240px] - [Main: flex-1] - [Inspector: 400px]
- **Inspector重複禁止**: 常にMainを縮小
- **Amber-500**: クライアント可視要素
- **楽観的更新**: 保存ボタン禁止
- **モーダル禁止**: タスク詳細

### Key RPC Functions

| RPC | Purpose |
|-----|---------|
| `rpc_pass_ball` | ボール移動 + 監査ログ |
| `rpc_decide_considering` | 検討中→決定 |
| `rpc_set_spec_state` | SPEC状態遷移 |
| `rpc_meeting_start/end` | 会議ライフサイクル |
| `rpc_parse_meeting_minutes` | 議事録→タスク生成 |
| `rpc_confirm_proposal_slot` | 日程調整スロット確定→会議自動作成 |

---

## Archive

古いバージョンは以下を参照:

- `docs/archive/api/` - API Spec v0.2, v0.3
- `docs/archive/db/` - DDL v0.1, v0.2
- `docs/archive/notes/` - DECISIONS v1-v4
- `docs/archive/prototypes/` - Prototype v9-v28
