# 日程調整・ビデオ会議連携 仕様書

> **Version**: 1.1
> **Last Updated**: 2026-02-14
> **Status**: 実装済み (Phase 1〜4 + セキュリティ修正 + 空き時間自動取得)

---

## 概要

内部ユーザーが候補日を提案 → 全参加者（内部+クライアント）が回答 → 条件を満たすスロットで会議確定 → ビデオ会議URL自動生成。

### UXフロー

```
[内部ユーザー]                    [クライアント]
     ├─ 1. 候補日を提案(2-5個)     │
     │   └─ 通知送信 ──────────────┤
     ├─ 2. 自分も回答               ├─ 3. ポータルで回答
     ├─ 4. 回答状況をリアルタイム確認 │
     ├─ 5. 確定可能スロットを選択    │
     │   └─ 会議作成+通知 ──────────┤
     └─ 会議ページで管理            └─ ポータルで会議確認
```

---

## データモデル

### テーブル

| テーブル | 説明 | マイグレーション |
|---------|------|--------------|
| `scheduling_proposals` | 日程調整提案 | `20260213_000` |
| `proposal_slots` | 候補日時スロット(2-5個) | `20260213_000` |
| `proposal_respondents` | 回答対象者(client/internal) | `20260213_000` |
| `slot_responses` | スロット回答(3択) | `20260213_000` |
| `integration_connections` | OAuth接続情報(統一) | `20260214_000` |
| `scheduling_reminder_log` | リマインダー送信ログ | `20260216_000` |

### scheduling_proposals

| Column | Type | 説明 |
|--------|------|------|
| id | uuid PK | |
| org_id | uuid FK | organizations |
| space_id | uuid FK | spaces |
| title | text NOT NULL | 提案タイトル(1-200文字) |
| description | text NULL | 補足説明(max 1000) |
| duration_minutes | integer | 会議時間(15-480分) |
| status | text | `open` / `confirmed` / `cancelled` / `expired` |
| version | integer | 楽観ロック用 |
| confirmed_slot_id | uuid FK NULL | 確定されたスロット |
| confirmed_meeting_id | uuid FK NULL | 作成された会議 |
| confirmed_at | timestamptz NULL | 確定日時 |
| confirmed_by | uuid FK NULL | 確定者 |
| video_provider | text NULL | `zoom` / `google_meet` / `teams` |
| meeting_url | text NULL | ビデオ会議URL |
| external_meeting_id | text NULL | プロバイダー側ID |
| expires_at | timestamptz NULL | 有効期限 |
| created_by | uuid FK | 作成者 |

### slot_responses — 回答3択

| 値 | 内部向けラベル | クライアント向け | 確定判定 |
|----|-------------|---------------|---------|
| `available` | 参加可能 | 参加できます | 可 |
| `unavailable_but_proceed` | 欠席OK | 欠席しますが進めてください | 可 |
| `unavailable` | 参加不可 | 参加できません | 不可 |

### 状態遷移

```
open → confirmed  (rpc_confirm_proposal_slot)
open → cancelled  (PATCH status='cancelled')
open → expired    (pg_cron自動 or クライアントサイド判定)
```

---

## RLS ポリシー

| テーブル | SELECT | INSERT | UPDATE |
|---------|--------|--------|--------|
| scheduling_proposals | space_memberships存在 | role in (admin,editor,member) + created_by=uid | created_by=uid or admin |
| proposal_slots | proposal経由でspace確認 | proposal.created_by=uid | - |
| proposal_respondents | proposal経由でspace確認 | proposal.created_by=uid | - |
| slot_responses | slot→proposal経由でspace確認 | respondent.user_id=uid + **slot/respondent同一proposal** | 同左 |

**セキュリティ強化**: `slot_responses`にDBトリガー`trg_check_slot_response_proposal`でslotとrespondentのproposal一致を二重保証。

---

## RPC: rpc_confirm_proposal_slot

```
入力: p_proposal_id uuid, p_slot_id uuid
出力: jsonb { ok, meeting_id?, slot_start?, slot_end?, error? }
```

処理フロー:
1. `auth.uid()` 認証チェック
2. `SELECT ... FOR UPDATE` 行ロック
3. 認可: creator or space admin
4. ステータスガード: `status = 'open'`
5. スロット所属確認: `slot.proposal_id = p_proposal_id`
6. required respondent数 > 0 ガード
7. eligible数チェック: `response IN ('available', 'unavailable_but_proceed')` かつ `pr.proposal_id = p_proposal_id`
8. `INSERT INTO meetings` → participants コピー → proposal status更新

権限: `REVOKE FROM PUBLIC/anon`, `GRANT TO authenticated`

---

## API ルート

### 内部API

| Method | Path | 説明 | 認可 |
|--------|------|------|------|
| POST | `/api/scheduling/proposals` | 提案作成 | role in (admin,editor,member) |
| GET | `/api/scheduling/proposals?spaceId=X` | 一覧取得 | space member |
| GET | `/api/scheduling/proposals/[id]` | 詳細取得 | space member |
| PATCH | `/api/scheduling/proposals/[id]` | キャンセル | creator or admin |
| POST | `/api/scheduling/proposals/[id]/confirm` | スロット確定 | creator or admin |
| POST | `/api/scheduling/responses` | 回答送信 | respondent |

### ポータルAPI

| Method | Path | 説明 | 認可 |
|--------|------|------|------|
| GET | `/api/portal/scheduling/proposals` | 自分がrespondentの提案一覧 | role='client' |
| POST | `/api/portal/scheduling/responses` | 回答送信 | role='client' + respondent |

### バリデーション

- タイトル: 1-200文字
- 説明: max 1000文字
- 所要時間: 15-480分
- スロット: 2-5個、未来日時、end > start
- 回答者: 1-50人、client 1人以上必須(AT-001準拠)
- 回答: max 5件/送信、slotId重複不可
- UUID: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` (v4限定ではなく汎用UUID)

---

## 統合接続基盤 (integration_connections)

### テーブル

| Column | Type | 説明 |
|--------|------|------|
| provider | text | `google_calendar` / `zoom` / `google_meet` / `teams` |
| owner_type | text | `user` / `org` |
| owner_id | uuid | user_id or org_id |
| access_token | text | アクセストークン |
| refresh_token | text NULL | リフレッシュトークン |
| token_expires_at | timestamptz | 有効期限 |
| status | text | `active` / `expired` / `revoked` |
| UNIQUE | | (provider, owner_type, owner_id) |

### OAuth フロー

```
1. GET /api/integrations/auth/[provider]?orgId=X
   → HMAC signed state生成 (15分有効)
   → プロバイダーのOAuth URLにリダイレクト

2. GET /api/integrations/callback/[provider]?code=...&state=...
   → state検証 (HMAC + timingSafeEqual + 15分期限)
   → code → token交換
   → integration_connections にupsert (service_role)
   → 設定画面にリダイレクト
```

### Token Manager

- `refreshIfNeeded()`: 5分バッファで自動リフレッシュ
- `getValidToken()`: 有効なaccess_tokenを返す
- `findConnection()`: provider + owner_type + owner_id + status='active'で検索

### フロントエンド

- `useIntegrations(orgId)`: 接続状態管理、connectGoogle、disconnect
- `IntegrationConnectionSafe`: access_token/refresh_tokenを除外した安全な型
- `IntegrationStatusBadge`: active(green) / disconnected(gray) / expired(red)
- `SetupGuide`: 折りたたみ式セットアップガイド (未接続→open, 接続済→closed)

---

## ビデオ会議連携

### プロバイダー抽象化

```typescript
interface VideoConferenceProvider {
  name: 'zoom' | 'google_meet' | 'teams'
  isConfigured(): boolean
  isUserConnected(userId: string): Promise<boolean>
  createMeeting(params: CreateMeetingParams): Promise<VideoMeetingResult>
  cancelMeeting(externalMeetingId: string, createdByUserId?: string): Promise<void>
}
```

### 各プロバイダー

| Provider | 認証方式 | API | 備考 |
|----------|---------|-----|------|
| Google Meet | ユーザーOAuth (Calendar) | Calendar Events API + conferenceData | Calendar連携必須 |
| Zoom | ユーザーOAuth → S2S フォールバック | `/users/me/meetings` | メモリキャッシュ |
| Teams | ユーザーOAuth(/me) → Client Credentials フォールバック | MS Graph `/onlineMeetings` | MS_ORGANIZER_USER_ID必要(CC時) |

### 確定フロー

1. `rpc_confirm_proposal_slot` 成功
2. `proposal.video_provider` を確認
3. プロバイダーがあれば `createMeeting()` 呼び出し（**creatorのOAuth接続**を使用）
4. `meeting_url` + `external_meeting_id` を proposals + meetings に保存
5. **ビデオ会議作成失敗は確定をブロックしない**

### Settings UI

- デフォルトプロバイダー選択 (`spaces.default_video_provider`)
- 各プロバイダーの接続状態 + OAuth接続ボタン
- セットアップガイド（手順説明付き）
- ポータル設定にもGoogle Calendar接続UI

---

## リアルタイム更新 (Phase 4)

### Supabase Realtime

`useRealtimeResponses(slotIds)`:
- `slot_responses` テーブルの INSERT/UPDATE をサブスクライブ
- SlotResponseGrid に「Live」バッジ表示
- cleanup で unsubscribe

### クライアントサイド期限切れ判定

`useSchedulingProposals`:
- `expires_at < now()` をクライアントで検出
- 即座にUIを「期限切れ」表示に切り替え

---

## 自動処理 (pg_cron)

### process_scheduling_expirations() — 5分間隔

- `status='open' AND expires_at < now()` → `status='expired'`
- 作成者にin_app通知 (`scheduling_proposal_expired`)
- `dedupe_key` で冪等

### process_scheduling_reminders() — 15分間隔

| タイプ | 条件 | 送信先 | メッセージ |
|-------|------|-------|----------|
| expiry_24h | 期限24h以内 + 未回答 | 未回答の回答者 | 「回答期限が明日です」 |
| unresponded_48h | 作成48h経過 + 未回答者あり | 作成者 | 「○○さんがまだ回答していません」 |

- `scheduling_reminder_log` テーブルで重複送信防止
- `notifications` テーブルに `ON CONFLICT DO NOTHING`

---

## 通知イベント

| Event | タイミング | 送信先 |
|-------|----------|-------|
| `scheduling_proposal_created` | 提案作成時 | 全respondent |
| `scheduling_response_submitted` | 回答時 | creator |
| `scheduling_slot_confirmed` | 確定時 | 全respondent |
| `scheduling_proposal_expired` | 期限切れ時 | creator |
| `scheduling_reminder` | リマインダー | 未回答者 or creator |

---

## MCP Server ツール

| ツール | 説明 |
|-------|------|
| `list_scheduling_proposals` | スペースの提案一覧 |
| `create_scheduling_proposal` | 提案作成 |
| `respond_to_proposal` | 回答送信 |
| `confirm_proposal_slot` | スロット確定 |

---

## 空き時間自動取得機能 (Phase 5)

> **Version**: 1.1 (2026-02-14追加)

### 概要

Googleカレンダー連携済みユーザーが、自分のカレンダーの空き時間から候補日を自動取得し、日程調整提案に入力する機能。

### UXフロー

```
[提案作成シート]
     │
     ├─ ① 「Googleカレンダーから空き時間を取得」をクリック
     │   └─ パネルが展開
     │
     ├─ ② 期間を指定（デフォルト: 明日〜7日後）
     │   └─ 「取得」ボタンをクリック
     │
     ├─ ③ FreeBusy APIで自分のbusyデータを取得
     │   └─ 営業時間(平日9:00-18:00)内の空きスロットを算出
     │
     ├─ ④ 空き枠リストから候補を選択（最大5件）
     │
     └─ ⑤ 「選択したN件を候補日に設定」で自動入力
```

### 前提条件

- Google Calendar 連携が有効 (`NEXT_PUBLIC_GOOGLE_CALENDAR_ENABLED=true`)
- 現在のユーザーがGoogleカレンダーを接続済み (`integration_connections.status='active'`)

### 処理ロジック

#### 空きスロット算出 (`computeAvailableSlots`)

**入力**:
- `busyPeriods`: FreeBusy APIから取得したbusy配列 `{ start, end }[]`
- `options`:
  - `startDate / endDate`: 対象期間 (YYYY-MM-DD)
  - `durationMinutes`: 所要時間
  - `businessHourStart`: 営業開始時刻 (default: 9)
  - `businessHourEnd`: 営業終了時刻 (default: 18)
  - `stepMinutes`: スロット間隔 (default: 30分)
  - `maxResults`: 最大結果数 (default: 20)

**アルゴリズム**:
1. 指定期間の各日をループ
2. 平日(月〜金)のみ処理
3. 営業時間内を `stepMinutes` 間隔でスキャン
4. 各候補スロットが `busyPeriods` と重複しないか判定
   - 重複条件: `busyStart < slotEnd && busyEnd > slotStart`
5. 重複しないスロットを `AvailableSlot` として返す

**出力**: `AvailableSlot[]`
```typescript
{
  startAt: string   // "YYYY-MM-DDTHH:mm" (datetime-local形式)
  endAt: string     // 同上
  dayOfWeek: number // 0=日, 1=月, ... 6=土
}
```

#### API利用

既存の `POST /api/integrations/freebusy` を使用。新規APIエンドポイントは不要。

```
POST /api/integrations/freebusy
{
  userIds: [currentUserId],
  timeMin: startDate + "T00:00:00" (ISO),
  timeMax: endDate + "T23:59:59" (ISO)
}
→ { calendars: { [userId]: { busy: [...] } } }
```

### コンポーネント

| Component | ファイル | 説明 |
|-----------|---------|------|
| AvailableSlotsSuggest | `src/components/scheduling/AvailableSlotsSuggest.tsx` | 空き時間取得UIパネル |
| computeAvailableSlots | `src/lib/scheduling/computeAvailableSlots.ts` | 空きスロット算出ロジック |

### 日本語表示フォーマット

`formatSlotLabel()`: `"2/15(金) 10:00〜11:00"` 形式

### 制約

- 営業時間はクライアントサイドで固定 (9:00-18:00 JST, 月〜金)
- 最大20件の候補を表示
- 選択可能数は `MAX_SLOTS` (5) に準拠
- GoogleカレンダーのFreeBusyスコープ (`calendar.freebusy`) のみ使用（予定詳細は取得しない）

---

## コンポーネント構成

### 内部UI (`src/components/scheduling/`)

| Component | 説明 |
|-----------|------|
| ProposalCreateSheet | 作成シート (z-50, Escape/backdrop close) |
| ProposalRow | リスト行 (タイトル, ステータスバッジ, 回答状況) |
| ProposalInspector | 右ペイン400px (マトリクス, 確定ボタン) |
| SlotResponseGrid | マトリクス表示 (行=回答者, 列=スロット) + Realtime |
| SlotResponseInput | 3択ラジオ |
| ProposalStatusBadge | blue=open, green=confirmed, gray=cancelled, red=expired |
| FreeBusyOverlay | Google Calendar空き/埋まり表示 |
| AvailableSlotsSuggest | 空き時間から候補日自動取得 |

### ポータルUI (`src/components/portal/scheduling/`)

| Component | 説明 |
|-----------|------|
| PortalProposalCard | 提案カード (回答ボタン付き) |
| PortalSlotResponseForm | 各スロットへの回答フォーム |

### 統合UI (`src/components/integrations/`)

| Component | 説明 |
|-----------|------|
| IntegrationStatusBadge | 接続状態バッジ |
| SetupGuide | 折りたたみ式セットアップガイド |

---

## 環境変数

### 必須

| 変数 | 説明 |
|------|------|
| `OAUTH_STATE_SECRET` | OAuth state HMAC秘密鍵 (`openssl rand -hex 32`) |

### Google Calendar / Meet

| 変数 | 説明 |
|------|------|
| `NEXT_PUBLIC_GOOGLE_CALENDAR_ENABLED` | `true` で有効 |
| `NEXT_PUBLIC_GOOGLE_MEET_ENABLED` | `true` で有効 |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret |

### Zoom (任意)

| 変数 | 説明 |
|------|------|
| `NEXT_PUBLIC_ZOOM_ENABLED` | `true` で有効 |
| `ZOOM_CLIENT_ID` | Zoom OAuth Client ID |
| `ZOOM_CLIENT_SECRET` | Zoom OAuth Client Secret |
| `ZOOM_ACCOUNT_ID` | S2S用 Account ID (任意) |

### Microsoft Teams (任意)

| 変数 | 説明 |
|------|------|
| `NEXT_PUBLIC_TEAMS_ENABLED` | `true` で有効 |
| `MS_CLIENT_ID` | Azure App Client ID |
| `MS_CLIENT_SECRET` | Azure App Client Secret |
| `MS_TENANT_ID` | Azure Tenant ID |
| `MS_ORGANIZER_USER_ID` | Client Credentials用 (任意) |

---

## マイグレーション一覧

| ファイル | 内容 |
|---------|------|
| `20260213_000_scheduling_proposals.sql` | コアテーブル4つ + RLS + RPC + trigger |
| `20260214_000_integration_connections.sql` | OAuth統合接続テーブル |
| `20260215_000_video_conference.sql` | spaces.default_video_provider + meetings拡張 |
| `20260216_000_scheduling_cron.sql` | リマインダーログ + 自動期限切れ + リマインダー関数 |
| `20260217_000_scheduling_security_fixes.sql` | RPC認可強化 + RLS修正 + DBトリガー + index |

---

## セキュリティ

### 実施済み対策

- OAuth state: HMAC-SHA256署名 + 15分有効期限 + timingSafeEqual
- RPC: SECURITY DEFINER + 内部auth.uid()チェック + REVOKE/GRANT
- RLS: 全テーブルにポリシー設定。slot_responsesはslot/respondent同一proposal検証
- Token: IntegrationConnectionSafe型でフロントエンドにaccess_token非送信
- 入力: UUID regex, enum check, 長さ制限, 未来日時検証
- 冪等: dedupe_key + ON CONFLICT DO NOTHING
- TOCTOU緩和: RPC内FOR UPDATEロック + UPDATEにWHERE status='open'

### Codex Code Review (2026-02-12)

全Critical/High指摘を修正済み:
- RPC認可不足 → auth.uid() + creator/admin判定追加
- RLS cross-proposal → proposal一致検証 + DBトリガー
- OAuth空文字秘密鍵 → 未設定時エラー
- confirm参加者取得バグ → profiles JOIN
- Google Meet cancelMeeting → createdByUserId追加
- Admin確定時token → creator のOAuth使用
- Cronインデックス → 部分index追加
