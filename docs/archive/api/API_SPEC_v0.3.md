# API Spec v0.3（Logical / Supabase + RPC）

> **目的**：DDL v0.2（`tasks.ball/origin/type/spec_path/decision_state`、`task_owners`、`task_events`、`reviews`、`meeting_participants`、`notifications`、`meetings`拡張）と **整合した** API / ロジック仕様。

---

## 0. 前提・方針

- **基本CRUDは Supabase Client（PostgREST + RLS）**で行う。
- **整合性が必要な操作（監査ログ、ステータス遷移、通知生成、会議開始/終了など）は RPC / Edge Functions**に寄せる。
- 文字列の enum 値は DB 側の CHECK を正とする。

### 命名
- DB: `snake_case`（例：`spec_path`）
- フロント: `camelCase` を使う場合は、**変換層**で対応（API仕様内では DB 名を併記）。

---

## 1. データモデル（DDL v0.2 準拠）

### 1.1 tasks（追加/更新）
- `status`：`backlog | todo | in_progress | in_review | done | considering`
- `ball`：`client | internal`（ボール所在）
- `origin`：`client | internal`（起案元）
- `type`：`task | spec`
- `spec_path`：`/spec/*.md#anchor`（`type='spec'` のとき必須）
- `decision_state`：`considering | decided | implemented`（`type='spec'` のとき必須）

**DB制約（重要）**
- `type='spec'` の場合：`spec_path` が `/spec/%#%` かつ `decision_state` が必須。

### 1.2 task_owners（新規）
- 目的：ボールオーナー（誰が決める/動くべきか）を機械的に追えるようにする。
- `side`：`client | internal`
- ユニーク：`(task_id, side, user_id)`

### 1.3 task_events（新規：監査ログ）
- `actor_id`：実操作したユーザー
- `meeting_id`：会議内操作なら紐付く（任意）
- `action`：任意文字列（**推奨 enum を後述**）
- `payload`：jsonb（onBehalfOf / evidence / confirmedBy 等を保存）

### 1.4 reviews / review_approvals（新規）
- `reviews.status`：`open | approved | changes_requested`
- `review_approvals.state`：`pending | approved | blocked`
- `blocked_reason`：差し戻し理由（任意）
- `reviews` は `task_id UNIQUE`（タスクごとに1件）

### 1.5 meetings（v0.1拡張）
- v0.1: `held_at`（開催日時） / `notes`（旧メモ）
- v0.2追加：
  - `status`：`planned | in_progress | ended`
  - `started_at`, `ended_at`
  - `minutes_md`（議事録Markdown）
  - `summary_subject`, `summary_body`（会議終了通知の生成結果を格納可能）

### 1.6 meeting_participants（新規）
- `side`：`client | internal`
- ユニーク：`(meeting_id, user_id)`

### 1.7 notifications（新規：in-app / email outbox）
- `channel`：`in_app | email`
- `type`：用途分類（例：`meeting_minutes`, `task_due_soon`, ...）
- `dedupe_key`：冪等キー（同一通知の重複作成防止）
- ユニーク：`(to_user_id, channel, dedupe_key)`

---

## 2. 推奨イベント（task_events.action）

DB上は自由文字列だが、分析・通知の一貫性のため推奨値を定義。

- `TASK_CREATE`
- `TASK_UPDATE`
- `PASS_BALL`（ball変更 + owners更新）
- `SET_OWNERS`（ownersの追加/削除）
- `CONSIDERING_DECIDE`（検討中の解決/決定）
- `SPEC_DECIDE`（spec決定＝decision_state: decided）
- `SPEC_IMPLEMENT`（spec反映＝decision_state: implemented）
- `REVIEW_OPEN`
- `REVIEW_APPROVE`
- `REVIEW_BLOCK`（差し戻し）
- `MEETING_START`
- `MEETING_END`

**payload 推奨キー（例）**
- `onBehalfOf`: `client | internal`（意思決定主体）
- `evidence`: `meeting | chat | email | call | other`
- `clientConfirmedBy`: `user_id`（会議外でクライアント確定として登録する場合に必須）
- `decisionText`: string
- `specPath`: string

---

## 3. Supabase（直接テーブル操作）

RLSの前提で、以下は通常の `from('<table>')` CRUD。

- `tasks`：一覧/詳細/編集
- `task_owners`：オーナー追加/削除（ただし**ボール遷移**は RPC 推奨）
- `meetings`：会議一覧/詳細（作成は通常InsertでOK）
- `meeting_participants`：参加者設定
- `reviews` / `review_approvals`：表示は直接取得OK（承認操作は RPC 推奨）
- `notifications`：in_app の未読一覧・既読更新

---

## 4. RPC（ビジネスロジック / 整合性）

> RPC名は実装時に `rpc_*` などへ寄せてもよい。

### 4.1 rpc_pass_ball
**目的**：ball 変更と owners 更新、監査ログを1トランザクションで。

**Input**
```json
{
  "task_id": "uuid",
  "ball": "client|internal",
  "client_owner_ids": ["uuid"],
  "internal_owner_ids": ["uuid"],
  "reason": "string (optional)",
  "meeting_id": "uuid (optional)"
}
```

**Rules**
- `ball='client'` の場合：`client_owner_ids.length >= 1` 必須
- `ball='internal'` の場合：`internal_owner_ids.length >= 1` 推奨（未設定だと運用事故）

**Effects**
- `tasks.ball` 更新
- `task_owners` を side ごとに upsert（指定配列と一致させる）
- `task_events` に `PASS_BALL`

**Output**
```json
{ "ok": true }
```

---

### 4.2 rpc_decide_considering
**目的**：検討中（considering）を「決定」し、会議内/会議外の根拠と主体を監査ログに残す。

**Input**
```json
{
  "task_id": "uuid",
  "decision_text": "string",
  "on_behalf_of": "client|internal",
  "evidence": "meeting|chat|email|call|other",
  "client_confirmed_by": "uuid (required when on_behalf_of=client AND evidence!=meeting)",
  "meeting_id": "uuid (optional)"
}
```

**Rules**
- 会議外で `on_behalf_of='client'` の場合：`client_confirmed_by` 必須
- 会議内（`evidence='meeting'`）は `client_confirmed_by` を推奨（会議参加者から選択）

**Effects**
- タスクの `status` は原則変更しない（プロダクトの状態設計に依存）。
  - ※現行方針：**入力は軽く、状態遷移は慎重**なので、状態は別操作で行う。
- `task_events` に `CONSIDERING_DECIDE`（payloadに decisionText / evidence / onBehalfOf / clientConfirmedBy）

**Output**
```json
{ "ok": true }
```

---

### 4.3 rpc_set_spec_state
**目的**：spec タスクの `decision_state` を変更し、監査ログも残す。

**Input**
```json
{
  "task_id": "uuid",
  "decision_state": "considering|decided|implemented",
  "meeting_id": "uuid (optional)",
  "note": "string (optional)"
}
```

**Rules**
- `type='spec'` の場合のみ許可
- `decision_state='decided'` へ遷移時：`spec_path` がセットされていること（DB制約でも担保）

**Effects**
- `tasks.decision_state` 更新
- `task_events`：`SPEC_DECIDE` または `SPEC_IMPLEMENT`

**Output**
```json
{ "ok": true }
```

---

### 4.4 rpc_review_open
**目的**：レビュー作成（`reviews` + `review_approvals` 初期化）

**Input**
```json
{
  "task_id": "uuid",
  "reviewer_ids": ["uuid"],
  "meeting_id": "uuid (optional)"
}
```

**Rules**
- `reviewer_ids.length >= 1` 必須
- `reviews` はタスクごとに1件（存在する場合は reviewer差し替え）

**Effects**
- `reviews` upsert（`status='open'`）
- `review_approvals` を reviewer_ids と一致するように upsert
- `task_events` に `REVIEW_OPEN`

---

### 4.5 rpc_review_approve / rpc_review_block
**目的**：承認・差し戻し（blocked）を厳密に。

**Approve Input**
```json
{ "task_id": "uuid", "meeting_id": "uuid (optional)" }
```

**Block Input**
```json
{ "task_id": "uuid", "blocked_reason": "string", "meeting_id": "uuid (optional)" }
```

**Effects（共通）**
- 対象reviewの `review_approvals` を更新
- 全員approvedなら `reviews.status='approved'`
- 1人でもblockedなら `reviews.status='changes_requested'`
- `task_events`：`REVIEW_APPROVE` or `REVIEW_BLOCK`

---

### 4.6 rpc_meeting_start
**目的**：会議開始（planned → in_progress）

**Input**
```json
{ "meeting_id": "uuid" }
```

**Effects**
- `meetings.status='in_progress'`
- `meetings.started_at=now()`
- `task_events` に `MEETING_START`（meeting_id で紐付け）

---

### 4.7 rpc_meeting_end
**目的**：会議終了（in_progress → ended） + まとめ生成 + 通知キュー作成（冪等）

**Input**
```json
{ "meeting_id": "uuid" }
```

**Effects**
- `meetings.status='ended'`
- `meetings.ended_at=now()`
- 会議サマリ生成（subject/body）を `meetings.summary_subject/body` に保存（任意）
- `task_events` に `MEETING_END`

**Output**
```json
{
  "ok": true,
  "summary_subject": "string",
  "summary_body": "string",
  "counts": { "decided": 0, "open": 0, "ball_client": 0 }
}
```

---

### 4.8 rpc_generate_meeting_minutes
**目的**：会議終了通知（メール＋アプリ内）文面をテンプレ生成。

**Input**
```json
{ "meeting_id": "uuid" }
```

**Output**
```json
{
  "email_subject": "string",
  "email_body": "string",
  "in_app_title": "string",
  "in_app_body": "string",
  "counts": { "decided": 0, "open": 0, "ball_client": 0 },
  "nearest_due": "timestamptz|null"
}
```

**未決抽出ルール（確定）**
- フリー文章から抽出しない。**タスク状態から抽出**。
- 対象（会議ページの未決定リストと同等）：
  - `tasks.status='considering' AND tasks.ball='client'`
  - + レビュー未完了（`reviews.status='open'` など）
  - + 仮決定（仕様側で定義する場合）

---

## 5. Edge Functions（外部送信/重い処理）

### 5.1 POST /functions/v1/send-meeting-minutes
**目的**：会議終了通知を、参加者＋未決担当者へ送る（メール＋in-app）

**Input**
```json
{ "meeting_id": "uuid" }
```

**Steps（推奨）**
1) `rpc_generate_meeting_minutes(meeting_id)`
2) 送信先を確定：
   - `meeting_participants` 全員
   - + 未決タスク（抽出ルール準拠）の `task_owners`（side に応じて）
3) `notifications` を upsert
   - `dedupe_key = meeting_id + ':' + ended_at`
   - channel: `in_app` と `email` の2本

**Idempotency**
- `notifications` の UNIQUE 制約で二重作成を防止。

---

## 6. 仕様リンク（specPath）について

- `tasks.spec_path` は **文字列**で保持（DDL v0.2 の CHECK で最低限担保）。
- 候補（オートコンプリート）は `spec/_INDEX.json` をクライアント側で参照。
- 将来、DBに `spec_docs/spec_sections` を追加し FK 化する余地はあるが、**現時点では不要**（移行コストが増えるため）。

---

## 7. 互換性メモ

- meetings の状態名は DDL v0.2 の `planned|in_progress|ended` を正。
  - 旧draftの `draft|live|ended` は使用しない。

