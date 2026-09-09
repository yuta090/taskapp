# API Spec v0.4（認証・招待・課金追加）

> **目的**：DDL v0.2 + 認証・招待・課金機能と **整合した** API / ロジック仕様。

---

## 0. 前提・方針

- **基本CRUDは Supabase Client（PostgREST + RLS）**で行う。
- **整合性が必要な操作（監査ログ、ステータス遷移、通知生成、会議開始/終了など）は RPC / Edge Functions**に寄せる。
- 認証は **Supabase Auth**（メール/パスワード）を使用。
- 文字列の enum 値は DB 側の CHECK を正とする。

### 命名
- DB: `snake_case`（例：`spec_path`）
- フロント: `camelCase` を使う場合は、**変換層**で対応（API仕様内では DB 名を併記）。

---

## 1. 認証 API

### 1.1 POST /api/auth/signup

新規登録（招待なし）。組織を新規作成し、Freeプランで開始。

**Input**
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "org_name": "株式会社サンプル"
}
```

**Process**
1. Supabase Auth: `signUp(email, password)`
2. RPC: `rpc_create_org_with_billing(org_name, user_id)`
   - organizations 作成
   - org_memberships 作成 (role='owner')
   - org_billing 作成 (plan_id='free')

**Output**
```json
{
  "user_id": "uuid",
  "org_id": "uuid",
  "plan_id": "free",
  "redirect_to": "/:orgId/project/:spaceId"
}
```

**Errors**
- `400`: メール形式不正、パスワード要件不足
- `409`: メールアドレス既存

---

### 1.2 POST /api/auth/login

ログイン。

**Input**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Process**
1. Supabase Auth: `signInWithPassword(email, password)`
2. ユーザーの最初の org/space を取得してリダイレクト先決定

**Output**
```json
{
  "user_id": "uuid",
  "redirect_to": "/portal or /:orgId/project/:spaceId"
}
```

**Errors**
- `401`: 認証失敗

---

### 1.3 POST /api/auth/reset

パスワードリセット要求。

**Input**
```json
{
  "email": "user@example.com"
}
```

**Process**
1. Supabase Auth: `resetPasswordForEmail(email)`

**Output**
```json
{
  "ok": true
}
```

---

### 1.4 POST /api/auth/reset/confirm

パスワード再設定。

**Input**
```json
{
  "password": "newSecurePassword123"
}
```

**Process**
1. Supabase Auth: `updateUser({ password })`
   - トークンはURLから自動取得

**Output**
```json
{
  "ok": true,
  "redirect_to": "/login"
}
```

---

## 2. 招待 API

### 2.1 POST /api/invites

招待作成・メール送信。

**Input**
```json
{
  "org_id": "uuid",
  "space_id": "uuid",
  "email": "invitee@example.com",
  "role": "client|member",
  "name": "山田 太郎（任意・100文字まで。一覧表示とメールの宛名に使う）",
  "message": "招待に添える一言（任意・500文字まで）",
  "template": { "subject": "...", "heading": "...", "body": "...", "cta_label": "...", "note": "..." },
  "save_as_template": false
}
```

`template` は招待メールの文面をこの1通だけ差し替えるもの（任意・部分指定可）。
`save_as_template: true` のときだけ、事務所の文面として保存される（→ 2.4）。

**Process**
1. 権限チェック（owner or admin）
2. `save_as_template` のときは事務所の owner/admin かを先に確認（招待を作る前に 403 で断る）
3. `template` があれば「いまの文面」に重ねて検証（必須・長さ・差し込み語）。不正なら 400
4. RPC: `rpc_create_invite(org_id, space_id, email, role, created_by)`
   - 制限チェック
   - トークン生成
   - invites 作成
5. `save_as_template` のときは RPC: `rpc_set_org_email_template(...)`
6. メール送信
   - role='client' → `/portal/:token`
   - role='member' → `/invite/:token`

**Output**
```json
{
  "invite_id": "uuid",
  "token": "string",
  "expires_at": "2025-03-04T00:00:00Z",
  "email_sent": true,
  "template_saved": true
}
```

`template_saved` は `save_as_template` を頼んだときだけ返る。保存に失敗しても招待とメールは止めない。

**Errors**
- `400`: 文面が不正（必須が空・長すぎる・使えない差し込み語）
- `402`: 人数枠に達した
- `403`: 権限なし／事務所の管理者でないのに保存を頼んだ
- `429`: プラン制限超過

---

### 2.2 GET /api/invites/:token

招待トークン検証。

**Process**
1. RPC: `rpc_validate_invite(token)`

**Output**
```json
{
  "valid": true,
  "email": "invitee@example.com",
  "role": "client|member",
  "org_id": "uuid",
  "org_name": "株式会社サンプル",
  "space_id": "uuid",
  "space_name": "Webリニューアル",
  "inviter_name": "田中太郎",
  "expires_at": "2025-03-04T00:00:00Z",
  "is_existing_user": false
}
```

**Errors**
- `404`: トークン無効、期限切れ、承諾済み

---

### 2.3 POST /api/invites/accept

招待受諾。

**Input**
```json
{
  "token": "string",
  "password": "string (新規ユーザーのみ必須)"
}
```

**Process**
1. トークン検証
2. 新規ユーザー: Supabase Auth `signUp(email, password)`
3. RPC: `rpc_accept_invite(token, user_id)`
   - org_memberships 作成
   - space_memberships 作成
   - invites.accepted_at 更新

**Output**
```json
{
  "user_id": "uuid",
  "org_id": "uuid",
  "space_id": "uuid",
  "role": "client|member",
  "redirect_to": "/portal or /:orgId/project/:spaceId"
}
```

**Errors**
- `400`: トークン無効
- `429`: プラン制限超過

---

### 2.4 GET /api/invites/pending

招待の一覧。`org_id`（事務所ぜんぶ・オーナーのみ）か `space_id`（そのプロジェクトだけ・
プロジェクトの admin/editor）のどちらかで引く。`status=all` を付けると承諾済み・期限切れも含む履歴（直近100件）。

**Output**
```json
{
  "invites": [
    {
      "id": "uuid", "email": "...", "invitee_name": "山田 太郎", "role": "member",
      "space_id": "uuid", "space_name": "...", "created_at": "...", "expires_at": "...",
      "accepted_at": null, "status": "pending|expired|accepted"
    }
  ],
  "can_manage": true
}
```

`status` は `accepted_at` と `expires_at` から決まる（`src/lib/invites/status.ts` が正本）。
`can_manage`（取り消し・再送の可否）は**事務所のオーナー/管理者、またはそのプロジェクトの管理者**のとき true
（`src/lib/invites/canManage.ts` が正本）。編集者は招待は出せるが取り消し・再送はできない。

---

### 2.5 GET / DELETE /api/invites/template

招待フォームに出す「いま使われている文面」の読み取りと、事務所の保存の取り消し。

**Query**: `space_id=<uuid>&role=client|member`

事務所(org)は `space_id` からサーバー側で引く（画面から渡された org_id は信用しない）。
権限は招待と同じ（事務所のメンバー かつ プロジェクトの admin/editor）。

**文面の決まり方（優先順）**
1. 事務所が保存したもの … `org_email_templates`（`source: "org"`）
2. 運営が管理画面で保存したもの … `email_templates`（`source: "platform"`）
3. コード既定 … `src/lib/email/templates/registry.ts`（`source: "code"`）

**GET Output**
```json
{
  "fields": { "subject": "...", "heading": "...", "body": "...", "cta_label": "...", "note": "..." },
  "source": "org|platform|code",
  "can_save_template": true
}
```

`can_save_template` は事務所の owner/admin のときだけ true。
保存は事務所全体（全プロジェクト）に効くため、プロジェクトの管理者では足りない。

**DELETE**: 事務所の保存を消して標準の文面に戻す（`rpc_reset_org_email_template`）。事務所の owner/admin のみ。

**Errors**
- `400`: role が不正／space_id の形式が不正
- `403`: 権限なし（DELETE は事務所の管理者以外）
- `404`: プロジェクトが無い

---

## 3. 課金 API

### 3.1 GET /api/billing/limits

組織の制限状況を取得。

**Process**
1. RPC: `rpc_check_org_limits(org_id)`

**Output**
```json
{
  "plan_id": "free",
  "plan_name": "Free",
  "projects": {
    "current": 3,
    "limit": 5,
    "can_add": true
  },
  "members": {
    "current": 2,
    "limit": 5,
    "can_add": true
  },
  "clients": {
    "current": 1,
    "limit": 5,
    "can_add": true
  },
  "storage": {
    "current_bytes": 10485760,
    "limit_bytes": 104857600,
    "can_add": true
  }
}
```

---

### 3.2 POST /api/billing/checkout (将来)

Stripe Checkout Session 作成。

**Input**
```json
{
  "org_id": "uuid",
  "plan_id": "pro|enterprise"
}
```

**Output**
```json
{
  "checkout_url": "https://checkout.stripe.com/..."
}
```

---

### 3.3 POST /api/billing/portal (将来)

Stripe Customer Portal Session 作成。

**Input**
```json
{
  "org_id": "uuid"
}
```

**Output**
```json
{
  "portal_url": "https://billing.stripe.com/..."
}
```

---

## 4. プロジェクト作成 API

### 4.1 POST /api/spaces/create-with-preset

プリセット付きプロジェクト（Space）作成。Space + メンバーシップ + マイルストーン + Wikiページを原子的に作成。

**Input**
```json
{
  "name": "Webサイトリニューアル",
  "presetGenre": "web_development",
  "orgId": "uuid"
}
```

`presetGenre` の有効値:
| 値 | ラベル | Wiki | マイルストーン |
|----|--------|------|---------------|
| `web_development` | Web/アプリ開発 | 5件（API/DB/UI仕様書+インフラ+ホーム） | 5件 |
| `system_development` | 業務システム開発 | 5件（要件定義書+DB設計+画面一覧+テスト計画+ホーム） | 6件 |
| `design` | デザイン制作 | 4件（ブリーフ+スタイルガイド+成果物+ホーム） | 5件 |
| `consulting` | コンサルティング | 4件（調査レポート+提案資料+議事録テンプレ+ホーム） | 5件 |
| `marketing` | マーケティング | 4件（キャンペーン+KPI+カレンダー+ホーム） | 5件 |
| `event` | イベント企画 | 4件（企画書+タイムライン+備品リスト+ホーム） | 5件 |
| `blank` | 白紙 | 0件 | 0件 |

**Process**
1. 認証チェック（Supabase Auth）
2. リクエストバリデーション（name必須、orgId=UUID、presetGenre=有効値）
3. プリセット定義取得（TypeScriptコードベース）
4. RPC: `rpc_create_space_with_preset` で原子的に作成
   - spaces作成（preset_genre記録）
   - space_memberships作成（creator=admin）
   - milestones一括作成
   - wiki_pages一括作成（spec pages → home page）
5. ホームページのspecリンクを実IDで更新（非致命的）

**Output**
```json
{
  "space": {
    "id": "uuid",
    "name": "Webサイトリニューアル",
    "preset_genre": "web_development",
    "org_id": "uuid"
  },
  "milestonesCreated": 5,
  "wikiPagesCreated": 5
}
```

**Errors**
- `400`: name未指定、orgId不正、presetGenre無効
- `401`: 未認証 / RPC側認証失敗
- `403`: org非メンバー
- `500`: RPC実行エラー

---

## 5. RPC一覧（認証・招待・課金・プリセット）

| RPC | 目的 |
|-----|------|
| `rpc_create_org_with_billing` | 新規登録時の組織+課金作成 |
| `rpc_check_org_limits` | 組織の制限状況取得 |
| `rpc_create_invite` | 招待作成（権限・制限チェック付き） |
| `rpc_validate_invite` | 招待トークン検証 |
| `rpc_accept_invite` | 招待受諾（メンバーシップ作成） |
| `rpc_create_space_with_preset` | プリセット付きSpace原子的作成（space+membership+milestones+wiki） |

---

## 5. データモデル（認証・課金追加）

### 5.1 plans

プラン定義（静的マスタ）。

| カラム | 型 | 説明 |
|--------|-----|------|
| id | text PK | 'free', 'pro', 'enterprise' |
| name | text | 表示名 |
| projects_limit | integer | NULL = 無制限 |
| members_limit | integer | 内部メンバー上限 |
| clients_limit | integer | クライアント上限 |
| storage_limit_bytes | bigint | NULL = 無制限 |
| stripe_product_id | text | Stripe連携用 |
| stripe_price_id | text | Stripe連携用 |
| is_active | boolean | 有効フラグ |

### 5.2 org_billing

組織の現在プラン。

| カラム | 型 | 説明 |
|--------|-----|------|
| org_id | uuid PK FK | organizations.id |
| plan_id | text FK | plans.id |
| status | text | 'active', 'trialing', 'past_due', 'canceled' |
| stripe_customer_id | text | Stripe顧客ID |
| stripe_subscription_id | text | StripeサブスクリプションID |
| current_period_end | timestamptz | 現在の請求期間終了 |
| cancel_at_period_end | boolean | 期間終了でキャンセル |

### 5.3 invites（既存 + インデックス追加）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| org_id | uuid FK | organizations.id |
| space_id | uuid FK | spaces.id |
| email | text | 招待先メール |
| role | text | 'client', 'member' |
| token | text UNIQUE | 招待トークン |
| expires_at | timestamptz | 有効期限（作成 + 30日） |
| accepted_at | timestamptz | 承諾日時（NULL = 未承諾） |
| created_by | uuid FK | auth.users.id |

---

### 5a. spaces（preset_genre追加）

| カラム | 型 | 説明 |
|--------|-----|------|
| preset_genre | text NULL | プリセットジャンル。NULL=旧来space（wiki自動生成あり）、'blank'=白紙、その他=ジャンル名 |

CHECK制約: `NULL` または `web_development`, `system_development`, `design`, `consulting`, `marketing`, `event`, `blank` のいずれか。

---

## 6. 既存API（v0.3から継続）

以下は API Spec v0.3 から変更なし:

- `rpc_pass_ball`
- `rpc_decide_considering`
- `rpc_set_spec_state`
- `rpc_review_open`
- `rpc_review_approve` / `rpc_review_block`
- `rpc_meeting_start`
- `rpc_meeting_end`
- `rpc_generate_meeting_minutes`
- `POST /functions/v1/send-meeting-minutes`

---

## 変更履歴

| バージョン | 日付 | 変更内容 |
|-----------|------|----------|
| v0.4.1 | 2026-02-14 | プロジェクトプリセット作成API追加（spaces/create-with-preset, rpc_create_space_with_preset） |
| v0.4 | 2025-02-02 | 認証・招待・課金API追加 |
| v0.3 | - | DDL v0.2準拠、会議・レビュー・通知 |
