# 認証・招待・課金 仕様書 v1.0

> **目的**: TaskApp の認証、ユーザー招待、課金機能の設計仕様を定義する。

---

## 1. 概要

### 1.1 スコープ

| 機能 | MVP | 将来 |
|------|-----|------|
| メール/パスワード認証 | ✅ | - |
| OAuth (Google, GitHub) | ❌ | ✅ |
| 新規登録（招待なし） | ✅ | - |
| ユーザー招待 | ✅ | - |
| Freeプラン | ✅ | - |
| Pro/Enterprise + Stripe | ❌ | ✅ |

### 1.2 ユーザータイプ

| タイプ | ロール | メイン画面 | 権限 |
|--------|--------|-----------|------|
| **内部メンバー** | `owner`, `member` | `/:orgId/project/:spaceId` | フルCRUD、会議、レビュー |
| **クライアント** | `client` | `/portal` (認証後) | 閲覧 + コメントのみ |

---

## 2. 認証

### 2.1 認証方式

- **Supabase Auth** (メール/パスワード)
- OAuth は将来対応（MVP外）

### 2.2 ルート構造

| ルート | 用途 | 認証状態 |
|--------|------|----------|
| `/login` | ログイン | Public |
| `/signup` | 新規登録（招待なし） | Public |
| `/reset` | パスワードリセット要求 | Public |
| `/reset/confirm` | パスワード再設定 | Public (トークン付き) |
| `/invite/:token` | 内部メンバー招待受諾 | Public |
| `/portal/:token` | クライアント招待受諾 | Public |
| `/portal` | クライアントダッシュボード | Authed (client) |
| `/:orgId/project/:spaceId` | 内部メイン画面 | Authed (owner/member) |

### 2.3 認証フロー

#### 2.3.1 ログイン

```
GET /login
  → メール/パスワード入力
  → POST /api/auth/login
     → Supabase Auth: signInWithPassword
  → 成功: リダイレクト
     - client → /portal
     - owner/member → /:orgId/project/:spaceId (最後に開いたスペース)
  → 失敗: エラー表示
```

#### 2.3.2 新規登録（招待なし）

```
GET /signup
  → メール/パスワード/組織名 入力
  → POST /api/auth/signup
     → Supabase Auth: signUp(email, password)
     → DB: organizations 作成
     → DB: org_memberships 作成 (role='owner')
     → DB: org_billing 作成 (plan_id='free')
  → メール確認 → ログイン
```

#### 2.3.3 パスワードリセット

```
GET /reset
  → メール入力
  → POST /api/auth/reset
     → Supabase Auth: resetPasswordForEmail
  → メール送信 → /reset/confirm でパスワード再設定
```

---

## 3. 招待

### 3.1 招待権限

| ロール | 招待可能 |
|--------|----------|
| `org.owner` | ✅ |
| `space.admin` | ✅ |
| その他 | ❌ |

### 3.2 招待フロー

#### 3.2.1 招待作成・送信

```
POST /api/invites
  Input:
    - email: string
    - org_id: uuid
    - space_id: uuid
    - role: 'client' | 'member'

  Process:
    1. 権限チェック (owner or admin)
    2. 制限チェック (プラン上限)
    3. トークン生成 (crypto.randomUUID)
    4. DB: invites 作成 (expires_at = now + 30日)
    5. Edge Function: メール送信
       - role='client' → /portal/:token
       - role='member' → /invite/:token

  Output:
    - invite_id, token, expires_at
```

#### 3.2.2 招待メール

```
件名: [組織名] の [スペース名] に招待されました

本文:
{inviter_name} さんから {org_name} の {space_name} に招待されました。

以下のリンクから参加してください:
{accept_url}

このリンクは {expires_at} まで有効です。
```

#### 3.2.3 招待受諾（新規ユーザー）

```
GET /portal/:token (client) or /invite/:token (member)
  → トークン検証
     - 存在チェック
     - 期限チェック (expires_at > now)
     - 未承諾チェック (accepted_at is null)
  → 受諾画面表示
     - メール（自動入力、編集不可）
     - パスワード設定
     - 組織/スペース名表示

POST /api/invites/accept
  Input:
    - token: string
    - password: string

  Process:
    1. トークン検証
    2. Supabase Auth: signUp(email, password)
    3. DB: org_memberships 作成
    4. DB: space_memberships 作成
    5. DB: invites.accepted_at = now()

  → リダイレクト
     - client → /portal
     - member → /:orgId/project/:spaceId
```

#### 3.2.4 招待受諾（既存ユーザー）

```
GET /portal/:token or /invite/:token
  → トークン検証
  → ログイン済み?
     - Yes → 自動でメンバーシップ作成 → リダイレクト
     - No → ログイン促進 → ログイン後に accept
```

### 3.3 招待テーブル（既存）

```sql
create table invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('client','member')),
  token text not null unique,
  expires_at timestamptz not null,  -- 作成時 + 30日
  accepted_at timestamptz null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index invites_token_idx on invites(token);
create index invites_email_idx on invites(email);
```

---

## 4. 課金

### 4.1 プラン定義

| プラン | プロジェクト | 内部メンバー | クライアント | ストレージ | 価格 |
|--------|-------------|-------------|-------------|-----------|------|
| **Free** | 5 | 5 | 5 | 100MB | ¥0 |
| **Pro** | 20 | 20 | 20 | 5GB | TBD |
| **Enterprise** | 無制限 | 無制限 | 無制限 | 無制限 | TBD |

### 4.2 課金スキーマ

```sql
-- plans: プラン定義（静的マスタ）
create table plans (
  id text primary key,              -- 'free' | 'pro' | 'enterprise'
  name text not null,
  projects_limit integer,           -- NULL = 無制限
  members_limit integer,            -- 内部メンバー (owner/member)
  clients_limit integer,            -- クライアント
  storage_limit_bytes bigint,       -- NULL = 無制限
  stripe_product_id text,           -- Stripe連携用（将来）
  stripe_price_id text,             -- Stripe連携用（将来）
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- org_billing: 組織の現在プラン
create table org_billing (
  org_id uuid primary key references organizations(id) on delete cascade,
  plan_id text not null references plans(id),
  status text not null default 'active'
    check (status in ('active','trialing','past_due','canceled')),
  stripe_customer_id text,          -- Stripe連携用（将来）
  stripe_subscription_id text,      -- Stripe連携用（将来）
  current_period_end timestamptz,   -- Stripe連携用（将来）
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index org_billing_plan_idx on org_billing(plan_id);
create index org_billing_stripe_customer_idx on org_billing(stripe_customer_id);

-- 初期データ
insert into plans (id, name, projects_limit, members_limit, clients_limit, storage_limit_bytes)
values
  ('free', 'Free', 5, 5, 5, 104857600),           -- 100MB
  ('pro', 'Pro', 20, 20, 20, 5368709120),         -- 5GB
  ('enterprise', 'Enterprise', null, null, null, null);
```

### 4.3 制限チェック RPC

```sql
-- rpc_check_org_limits: 組織の制限状況を取得
create or replace function rpc_check_org_limits(p_org_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_plan plans%rowtype;
  v_projects_count integer;
  v_members_count integer;
  v_clients_count integer;
  v_storage_bytes bigint;
begin
  -- 現在のプランを取得
  select p.* into v_plan
  from org_billing ob
  join plans p on p.id = ob.plan_id
  where ob.org_id = p_org_id;

  -- 現在の使用量を集計
  select count(*) into v_projects_count
  from spaces where org_id = p_org_id and type = 'project';

  select count(*) into v_members_count
  from org_memberships where org_id = p_org_id and role in ('owner', 'member');

  select count(*) into v_clients_count
  from org_memberships where org_id = p_org_id and role = 'client';

  -- ストレージは将来実装（現在は0）
  v_storage_bytes := 0;

  return jsonb_build_object(
    'plan_id', v_plan.id,
    'plan_name', v_plan.name,
    'projects', jsonb_build_object(
      'current', v_projects_count,
      'limit', v_plan.projects_limit,
      'can_add', v_plan.projects_limit is null or v_projects_count < v_plan.projects_limit
    ),
    'members', jsonb_build_object(
      'current', v_members_count,
      'limit', v_plan.members_limit,
      'can_add', v_plan.members_limit is null or v_members_count < v_plan.members_limit
    ),
    'clients', jsonb_build_object(
      'current', v_clients_count,
      'limit', v_plan.clients_limit,
      'can_add', v_plan.clients_limit is null or v_clients_count < v_plan.clients_limit
    ),
    'storage', jsonb_build_object(
      'current_bytes', v_storage_bytes,
      'limit_bytes', v_plan.storage_limit_bytes,
      'can_add', v_plan.storage_limit_bytes is null or v_storage_bytes < v_plan.storage_limit_bytes
    )
  );
end;
$$;
```

### 4.4 Stripe連携（将来）

MVP後に以下を実装:

1. **Checkout Session 作成** - Pro/Enterprise 購入
2. **Customer Portal** - プラン変更・キャンセル
3. **Webhook Handler** - `checkout.session.completed`, `customer.subscription.*`

---

## 5. API仕様

### 5.1 認証 API

#### POST /api/auth/signup

```typescript
// Request
{
  email: string;
  password: string;
  org_name: string;
}

// Response
{
  user_id: string;
  org_id: string;
  redirect_to: string;
}
```

#### POST /api/auth/login

```typescript
// Request
{
  email: string;
  password: string;
}

// Response
{
  user_id: string;
  redirect_to: string;
}
```

### 5.2 招待 API

#### POST /api/invites

```typescript
// Request
{
  org_id: string;
  space_id: string;
  email: string;
  role: 'client' | 'member';
}

// Response
{
  invite_id: string;
  token: string;
  expires_at: string;
}
```

#### GET /api/invites/:token

```typescript
// Response
{
  valid: boolean;
  email: string;
  org_name: string;
  space_name: string;
  role: 'client' | 'member';
  expires_at: string;
  is_existing_user: boolean;
}
```

#### POST /api/invites/accept

```typescript
// Request
{
  token: string;
  password?: string;  // 新規ユーザーのみ必須
}

// Response
{
  user_id: string;
  org_id: string;
  space_id: string;
  redirect_to: string;
}
```

---

## 6. UI画面

### 6.1 ログイン `/login`

```
┌─────────────────────────────────────┐
│           TaskApp ログイン            │
├─────────────────────────────────────┤
│                                     │
│  メールアドレス                       │
│  ┌─────────────────────────────┐   │
│  │                             │   │
│  └─────────────────────────────┘   │
│                                     │
│  パスワード                          │
│  ┌─────────────────────────────┐   │
│  │                             │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │        ログイン              │   │
│  └─────────────────────────────┘   │
│                                     │
│  パスワードを忘れた方                  │
│  アカウントをお持ちでない方 → 新規登録   │
│                                     │
└─────────────────────────────────────┘
```

### 6.2 新規登録 `/signup`

```
┌─────────────────────────────────────┐
│         TaskApp 新規登録             │
├─────────────────────────────────────┤
│                                     │
│  組織名                              │
│  ┌─────────────────────────────┐   │
│  │                             │   │
│  └─────────────────────────────┘   │
│                                     │
│  メールアドレス                       │
│  ┌─────────────────────────────┐   │
│  │                             │   │
│  └─────────────────────────────┘   │
│                                     │
│  パスワード                          │
│  ┌─────────────────────────────┐   │
│  │                             │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │      アカウント作成           │   │
│  └─────────────────────────────┘   │
│                                     │
│  Free プランで開始                   │
│  • プロジェクト 5件                  │
│  • メンバー 5名                      │
│  • クライアント 5名                  │
│                                     │
└─────────────────────────────────────┘
```

### 6.3 招待受諾 `/portal/:token` or `/invite/:token`

```
┌─────────────────────────────────────┐
│      [Org名] に招待されました         │
├─────────────────────────────────────┤
│                                     │
│  {inviter_name} さんから             │
│  {space_name} に招待されました        │
│                                     │
│  メールアドレス                       │
│  ┌─────────────────────────────┐   │
│  │ email@example.com (固定)    │   │
│  └─────────────────────────────┘   │
│                                     │
│  パスワードを設定                     │
│  ┌─────────────────────────────┐   │
│  │                             │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │        参加する              │   │
│  └─────────────────────────────┘   │
│                                     │
│  すでにアカウントをお持ちの方 → ログイン │
│                                     │
└─────────────────────────────────────┘
```

---

## 7. 受け入れテスト

### AT-AUTH-001 新規登録

- [ ] メール/パスワード/組織名で登録できる
- [ ] 登録後、自動でFreeプランが適用される
- [ ] 登録後、組織のownerになっている

### AT-AUTH-002 ログイン

- [ ] メール/パスワードでログインできる
- [ ] ログイン後、適切な画面にリダイレクトされる（client→/portal, member→/:orgId/...）
- [ ] パスワード間違いでエラー表示される

### AT-AUTH-003 パスワードリセット

- [ ] リセットメールが送信される
- [ ] リンクから新パスワードを設定できる

### AT-INVITE-001 招待作成

- [ ] owner/adminのみ招待を作成できる
- [ ] プラン制限を超える招待は作成できない
- [ ] 招待メールが送信される（組織名/スペース名含む）

### AT-INVITE-002 招待受諾（新規）

- [ ] トークンからメールが自動入力される
- [ ] パスワード設定で登録できる
- [ ] 適切なメンバーシップが作成される
- [ ] 期限切れトークンは拒否される

### AT-INVITE-003 招待受諾（既存）

- [ ] ログイン済みなら自動でメンバーシップ作成
- [ ] 未ログインならログイン促進→accept

### AT-BILLING-001 プラン制限

- [ ] プロジェクト数がプラン上限を超えると作成不可
- [ ] メンバー数がプラン上限を超えると招待不可
- [ ] 制限に達した場合、アップグレード案内が表示される

---

## 8. 実装順序

| Phase | 内容 | 依存 |
|-------|------|------|
| 1 | DDL: plans, org_billing テーブル追加 | - |
| 2 | RPC: rpc_check_org_limits | Phase 1 |
| 3 | `/login`, `/reset`, `/reset/confirm` | - |
| 4 | `/signup` + org作成 + Free開始 | Phase 1, 2 |
| 5 | `/invite/:token`, `/portal/:token` | Phase 4 |
| 6 | POST /api/invites + メール送信 | Phase 5 |
| 7 | 制限チェックUI（残数表示、警告） | Phase 2 |
| 8 | Stripe連携（Pro/Enterprise） | Phase 7完了後 |

---

## 変更履歴

| 日付 | バージョン | 変更内容 |
|------|-----------|----------|
| 2025-02-02 | v1.0 | 初版作成 |
