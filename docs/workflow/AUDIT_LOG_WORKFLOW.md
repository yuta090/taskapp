# 監査ログシステム実装ワークフロー

## 概要
TaskAppの全操作履歴を完全に記録する監査ログシステムの実装計画

## 実装フェーズ

---

## Phase 1: データベース基盤 (優先度: Critical)

### 1.1 audit_logsテーブル作成
**依存**: なし
**所要時間**: 15分

```sql
-- DDL: supabase/migrations/xxx_create_audit_logs.sql

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  space_id uuid not null references spaces(id),

  -- 誰が
  actor_id uuid references profiles(id),
  actor_role text,  -- 'client' | 'owner' | 'member'

  -- 何をした
  event_type text not null,
  target_type text not null,  -- 'task' | 'comment' | 'milestone' | 'meeting' | 'member'
  target_id uuid,

  -- 詳細
  summary text,
  data_before jsonb,
  data_after jsonb,
  metadata jsonb,

  -- 表示制御
  visibility text not null default 'team',  -- 'client' | 'team'

  occurred_at timestamptz not null default now()
);

-- インデックス
create index audit_logs_space_time_idx on audit_logs (space_id, occurred_at desc);
create index audit_logs_target_idx on audit_logs (target_type, target_id);
create index audit_logs_actor_idx on audit_logs (actor_id, occurred_at desc);
create index audit_logs_event_idx on audit_logs (event_type, occurred_at desc);
```

**検証**: テーブル作成確認、インデックス確認

### 1.2 RLSポリシー設定
**依存**: 1.1
**所要時間**: 10分

```sql
alter table audit_logs enable row level security;

-- クライアントは visibility='client' のみ閲覧可
-- チーム（owner/member）は全件閲覧可
create policy audit_logs_select on audit_logs for select using (
  exists (
    select 1 from space_memberships sm
    where sm.space_id = audit_logs.space_id
      and sm.user_id = auth.uid()
      and (
        audit_logs.visibility = 'client'
        or sm.role in ('owner', 'member')
      )
  )
);

-- 挿入は全員可（アプリ層で制御）
create policy audit_logs_insert on audit_logs for insert
with check (true);

-- 更新・削除は禁止（監査ログは不変）
create policy audit_logs_no_update on audit_logs for update using (false);
create policy audit_logs_no_delete on audit_logs for delete using (false);
```

**検証**: RLSが有効か確認、client/memberで閲覧テスト

---

## Phase 2: ログ記録ヘルパー関数 (優先度: High)

### 2.1 共通ログ記録関数作成
**依存**: Phase 1
**所要時間**: 20分
**ファイル**: `src/lib/audit.ts`

```typescript
interface AuditLogParams {
  supabase: SupabaseClient
  orgId: string
  spaceId: string
  actorId: string
  actorRole: 'client' | 'owner' | 'member'
  eventType: string
  targetType: 'task' | 'comment' | 'milestone' | 'meeting' | 'member' | 'review'
  targetId: string
  summary?: string
  dataBefore?: Record<string, unknown>
  dataAfter?: Record<string, unknown>
  metadata?: Record<string, unknown>
  visibility?: 'client' | 'team'
}

export async function createAuditLog(params: AuditLogParams): Promise<void>
```

**検証**: 単体テスト作成

---

## Phase 3: 既存APIへのログ記録追加 (優先度: High)

### 3.1 クライアントポータル（承認・修正依頼）- 既存修正
**依存**: Phase 2
**所要時間**: 15分
**ファイル**: `src/app/api/portal/tasks/[taskId]/route.ts`

現在のaudit_logs挿入を共通関数に置き換え

**イベント**:
- `approval.approved` (visibility: client)
- `approval.changes_requested` (visibility: client)

### 3.2 タスク操作（内部）
**依存**: Phase 2
**所要時間**: 30分
**ファイル**: `src/lib/hooks/useTasks.ts` または対応API

**イベント**:
- `task.created` (visibility: team)
- `task.updated` (visibility: team)
- `task.status_changed` (visibility: client)
- `task.ball_moved` (visibility: client)
- `task.deleted` (visibility: team)

### 3.3 コメント操作
**依存**: Phase 2
**所要時間**: 20分

**イベント**:
- `comment.added` (visibility: task_comments.visibilityに連動)
- `comment.edited` (visibility: team)
- `comment.deleted` (visibility: team)

### 3.4 マイルストーン操作
**依存**: Phase 2
**所要時間**: 15分

**イベント**:
- `milestone.created` (visibility: client)
- `milestone.updated` (visibility: client)
- `milestone.completed` (visibility: client)
- `milestone.deleted` (visibility: team)

### 3.5 レビュー操作
**依存**: Phase 2
**所要時間**: 20分

**イベント**:
- `review.started` (visibility: team)
- `review.approved` (visibility: team)
- `review.rejected` (visibility: team)

### 3.6 ミーティング操作
**依存**: Phase 2
**所要時間**: 15分

**イベント**:
- `meeting.created` (visibility: client)
- `meeting.started` (visibility: client)
- `meeting.ended` (visibility: client)
- `meeting.minutes_parsed` (visibility: team)

### 3.7 メンバー・招待操作
**依存**: Phase 2
**所要時間**: 20分

**イベント**:
- `member.invited` (visibility: team)
- `member.joined` (visibility: client)
- `member.removed` (visibility: team)
- `member.role_changed` (visibility: team)

### 3.8 その他の操作
**依存**: Phase 2
**所要時間**: 15分

**イベント**:
- `export.created` (visibility: team)
- `api_key.created` (visibility: team)
- `api_key.deleted` (visibility: team)

---

## Phase 4: ダッシュボード表示 (優先度: Medium)

### 4.1 ポータルダッシュボードのアクティビティ表示修正
**依存**: Phase 1, 3.1
**所要時間**: 20分
**ファイル**: `src/app/portal/page.tsx`

audit_logsから最新5件を取得して表示

### 4.2 内部管理画面のアクティビティ表示
**依存**: Phase 1, Phase 3
**所要時間**: 30分

チーム向けに全アクティビティを表示するUI追加

---

## Phase 5: 検証・テスト (優先度: High)

### 5.1 統合テスト
**依存**: Phase 3, 4
**所要時間**: 30分

- 各操作でログが正しく記録されることを確認
- RLSによる表示フィルタリングが正しく動作することを確認
- パフォーマンステスト（大量ログ時の応答速度）

---

## 実行順序チェックリスト

- [ ] **1.1** audit_logsテーブル作成
- [ ] **1.2** RLSポリシー設定
- [ ] **2.1** 共通ログ記録関数作成
- [ ] **3.1** ポータル承認APIのログ形式統一
- [ ] **4.1** ダッシュボードのアクティビティ表示修正
- [ ] **3.2** タスク操作のログ追加
- [ ] **3.3** コメント操作のログ追加
- [ ] **3.4** マイルストーン操作のログ追加
- [ ] **3.5** レビュー操作のログ追加
- [ ] **3.6** ミーティング操作のログ追加
- [ ] **3.7** メンバー・招待操作のログ追加
- [ ] **3.8** その他の操作のログ追加
- [ ] **4.2** 内部管理画面のアクティビティ表示
- [ ] **5.1** 統合テスト

---

## イベントタイプ一覧（完全版）

| event_type | target_type | visibility | 説明 |
|------------|-------------|------------|------|
| `task.created` | task | team | タスク作成 |
| `task.updated` | task | team | タスク更新 |
| `task.status_changed` | task | client | ステータス変更 |
| `task.ball_moved` | task | client | ボール移動 |
| `task.deleted` | task | team | タスク削除 |
| `comment.added` | comment | * | コメント追加 |
| `comment.edited` | comment | team | コメント編集 |
| `comment.deleted` | comment | team | コメント削除 |
| `approval.approved` | task | client | タスク承認 |
| `approval.changes_requested` | task | client | 修正依頼 |
| `milestone.created` | milestone | client | マイルストーン作成 |
| `milestone.updated` | milestone | client | マイルストーン更新 |
| `milestone.completed` | milestone | client | マイルストーン完了 |
| `milestone.deleted` | milestone | team | マイルストーン削除 |
| `review.started` | review | team | レビュー開始 |
| `review.approved` | review | team | レビュー承認 |
| `review.rejected` | review | team | レビュー差し戻し |
| `meeting.created` | meeting | client | 会議作成 |
| `meeting.started` | meeting | client | 会議開始 |
| `meeting.ended` | meeting | client | 会議終了 |
| `meeting.minutes_parsed` | meeting | team | 議事録パース |
| `member.invited` | member | team | メンバー招待 |
| `member.joined` | member | client | メンバー参加 |
| `member.removed` | member | team | メンバー削除 |
| `member.role_changed` | member | team | 役割変更 |
| `export.created` | export | team | エクスポート実行 |
| `api_key.created` | api_key | team | APIキー作成 |
| `api_key.deleted` | api_key | team | APIキー削除 |

---

## 次のステップ

このワークフローを実行するには:
```
/sc:implement AUDIT_LOG_WORKFLOW.md
```

または手動で Phase 1 から順番に実行してください。
