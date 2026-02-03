# Implementation Workflow: GitHub連携

## Overview

SpaceとGitHubリポジトリを連携し、PR/コミット情報をタスクに紐付ける機能の実装ワークフロー。

**機能:**
- GitHub App インストール（組織レベル）
- Space へのリポジトリ紐付け
- Webhook による PR 自動同期（今からのみ）
- タスク詳細画面での関連PR表示
- コミットメッセージ/PRタイトルからタスクID自動検出

**スコープ外（Phase 2以降）:**
- 過去データの一括インポート（Upstash QStash使用）
- GitHub Issues 同期
- コミット詳細表示

---

## 技術選定

| 項目 | 選定 | 理由 |
|------|------|------|
| 認証方式 | GitHub App | OAuth Appより権限が細かく、Webhook受信が容易 |
| 同期方式 | Webhook（今からのみ） | Vercel制限対応、シンプル |
| 過去データ | Phase 2でQStash | 大量データはキュー処理必須 |

---

## Phase 1: データベース準備

### 1.1 GitHub連携テーブル追加
**ファイル:** `supabase/migrations/YYYYMMDD_github_integration.sql`

**テーブル:**
```sql
-- GitHub App インストール情報（組織単位）
create table if not exists github_installations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  installation_id bigint not null,
  account_login text not null,
  account_type text not null default 'Organization', -- Organization | User
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, installation_id)
);

-- 連携可能なリポジトリ一覧
create table if not exists github_repositories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  installation_id bigint not null,
  repo_id bigint not null,
  owner_login text not null,
  repo_name text not null,
  full_name text generated always as (owner_login || '/' || repo_name) stored,
  default_branch text,
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, repo_id)
);

-- Space と リポジトリの紐付け（N:N）
create table if not exists space_github_repos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  github_repo_id uuid not null references github_repositories(id) on delete cascade,
  sync_prs boolean not null default true,
  sync_commits boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (space_id, github_repo_id)
);

-- PR情報
create table if not exists github_pull_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  github_repo_id uuid not null references github_repositories(id) on delete cascade,
  pr_number int not null,
  pr_title text not null,
  pr_url text not null,
  pr_state text not null, -- open | closed | merged
  author_login text,
  head_branch text,
  base_branch text,
  merged_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (github_repo_id, pr_number)
);

-- タスクとPRの紐付け
create table if not exists task_github_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  github_pr_id uuid not null references github_pull_requests(id) on delete cascade,
  link_type text not null default 'auto', -- auto | manual
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (task_id, github_pr_id)
);

-- Webhook イベントログ（デバッグ/監査用）
create table if not exists github_webhook_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete set null,
  installation_id bigint,
  event_type text not null,
  action text,
  delivery_id text,
  payload jsonb not null,
  processed boolean not null default false,
  error_message text,
  received_at timestamptz not null default now()
);

create unique index if not exists github_webhook_events_delivery_unique
on github_webhook_events(delivery_id)
where delivery_id is not null;
```

**RLS ポリシー:**
```sql
-- github_installations
alter table github_installations enable row level security;
create policy "org members can view installations"
  on github_installations for select
  using (org_id in (select org_id from org_memberships where user_id = auth.uid()));

-- github_repositories
alter table github_repositories enable row level security;
create policy "org members can view repositories"
  on github_repositories for select
  using (org_id in (select org_id from org_memberships where user_id = auth.uid()));

-- space_github_repos
alter table space_github_repos enable row level security;
create policy "space members can view repo links"
  on space_github_repos for select
  using (space_id in (select space_id from space_memberships where user_id = auth.uid()));

-- github_pull_requests
alter table github_pull_requests enable row level security;
create policy "org members can view PRs"
  on github_pull_requests for select
  using (org_id in (select org_id from org_memberships where user_id = auth.uid()));

-- task_github_links
alter table task_github_links enable row level security;
create policy "org members can view task links"
  on task_github_links for select
  using (org_id in (select org_id from org_memberships where user_id = auth.uid()));
```

**依存関係:** なし

---

## Phase 2: GitHub App 設定

### 2.1 GitHub App 作成
**場所:** GitHub Developer Settings

**設定項目:**
```
App Name: TaskApp Integration
Homepage URL: https://taskapp.example.com
Callback URL: https://taskapp.example.com/api/github/callback
Setup URL: https://taskapp.example.com/api/github/setup
Webhook URL: https://taskapp.example.com/api/github/webhook
Webhook Secret: [生成して保存]

Permissions:
  Repository:
    - Pull requests: Read
    - Contents: Read (コミット取得用)
    - Metadata: Read

  Subscribe to events:
    - Pull request
    - Push (Phase 2)
```

### 2.2 環境変数設定
**ファイル:** `.env.local`

```env
GITHUB_APP_ID=123456
GITHUB_APP_CLIENT_ID=Iv1.xxxxxxxxxx
GITHUB_APP_CLIENT_SECRET=xxxxxxxxxxxx
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx
```

**依存関係:** 2.1完了後

---

## Phase 3: API Routes 実装

### 3.1 GitHub OAuth コールバック
**ファイル:** `src/app/api/github/callback/route.ts`

**目的:** GitHub App インストール後のコールバック処理

**実装内容:**
```typescript
// 1. installation_id を取得
// 2. GitHub API でアクセストークン取得
// 3. インストール情報を github_installations に保存
// 4. リポジトリ一覧を github_repositories に保存
// 5. 設定画面にリダイレクト
```

**依存関係:** Phase 1, 2 完了後

### 3.2 Webhook ハンドラー
**ファイル:** `src/app/api/github/webhook/route.ts`

**目的:** GitHub Webhook イベントの受信と処理

**実装内容:**
```typescript
export async function POST(req: Request) {
  // 1. 署名検証
  const signature = req.headers.get('x-hub-signature-256')
  const payload = await req.text()
  if (!verifyWebhookSignature(payload, signature)) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // 2. イベント種別判定
  const event = req.headers.get('x-github-event')
  const data = JSON.parse(payload)

  // 3. イベントログ保存
  await supabase.from('github_webhook_events').insert({
    installation_id: data.installation?.id,
    event_type: event,
    action: data.action,
    delivery_id: req.headers.get('x-github-delivery'),
    payload: data
  })

  // 4. イベント処理
  switch (event) {
    case 'pull_request':
      await handlePullRequestEvent(data)
      break
    case 'installation':
      await handleInstallationEvent(data)
      break
  }

  return Response.json({ ok: true })
}
```

**依存関係:** 3.1と並行可

### 3.3 PR イベント処理
**ファイル:** `src/lib/github/handlers/pull-request.ts`

**目的:** PR作成/更新/マージ時の処理

**実装内容:**
```typescript
export async function handlePullRequestEvent(data: PullRequestEvent) {
  const { action, pull_request, repository, installation } = data

  // 1. org_id を installation_id から逆引き
  const { data: inst } = await supabase
    .from('github_installations')
    .select('org_id')
    .eq('installation_id', installation.id)
    .single()

  if (!inst) return // 未登録のインストールは無視

  // 2. github_repo_id を取得
  const { data: repo } = await supabase
    .from('github_repositories')
    .select('id')
    .eq('org_id', inst.org_id)
    .eq('repo_id', repository.id)
    .single()

  if (!repo) return // 未連携リポジトリは無視

  // 3. PR情報を upsert
  const prState = pull_request.merged ? 'merged'
    : pull_request.state === 'closed' ? 'closed'
    : 'open'

  await supabase.from('github_pull_requests').upsert({
    org_id: inst.org_id,
    github_repo_id: repo.id,
    pr_number: pull_request.number,
    pr_title: pull_request.title,
    pr_url: pull_request.html_url,
    pr_state: prState,
    author_login: pull_request.user.login,
    head_branch: pull_request.head.ref,
    base_branch: pull_request.base.ref,
    merged_at: pull_request.merged_at,
    closed_at: pull_request.closed_at,
    created_at: pull_request.created_at
  }, {
    onConflict: 'github_repo_id,pr_number'
  })

  // 4. タスクID検出と紐付け
  await linkPRToTasks(inst.org_id, repo.id, pull_request)
}
```

**依存関係:** 3.2完了後

### 3.4 タスクID自動検出
**ファイル:** `src/lib/github/task-linker.ts`

**目的:** PR タイトル/本文からタスクIDを検出して紐付け

**実装内容:**
```typescript
// タスクID検出パターン: #TP-001, TP-001, [TP-001]
const TASK_ID_PATTERN = /(?:#?|\[)(TP-\d+)(?:\])?/gi

export async function linkPRToTasks(
  orgId: string,
  repoId: string,
  pr: PullRequest
) {
  // タイトルと本文からタスクID抽出
  const text = `${pr.title} ${pr.body || ''}`
  const matches = [...text.matchAll(TASK_ID_PATTERN)]
  const taskShortIds = [...new Set(matches.map(m => m[1].toUpperCase()))]

  if (taskShortIds.length === 0) return

  // PR の github_pull_requests.id を取得
  const { data: prRecord } = await supabase
    .from('github_pull_requests')
    .select('id')
    .eq('github_repo_id', repoId)
    .eq('pr_number', pr.number)
    .single()

  // 該当タスクを検索してリンク作成
  for (const shortId of taskShortIds) {
    const { data: task } = await supabase
      .from('tasks')
      .select('id, space_id')
      .eq('org_id', orgId)
      .eq('short_id', shortId)
      .single()

    if (!task) continue

    // Space がこのリポジトリと連携しているか確認
    const { data: spaceRepo } = await supabase
      .from('space_github_repos')
      .select('id')
      .eq('space_id', task.space_id)
      .eq('github_repo_id', repoId)
      .single()

    if (!spaceRepo) continue

    // リンク作成
    await supabase.from('task_github_links').upsert({
      org_id: orgId,
      task_id: task.id,
      github_pr_id: prRecord.id,
      link_type: 'auto'
    }, {
      onConflict: 'task_id,github_pr_id',
      ignoreDuplicates: true
    })
  }
}
```

**依存関係:** 3.3完了後

---

## Phase 4: フロントエンド - 設定画面

### 4.1 GitHub連携設定ページ
**ファイル:** `src/app/(internal)/[orgId]/settings/integrations/github/page.tsx`

**目的:** GitHub App のインストール状況確認と管理

**UI:**
```
┌─────────────────────────────────────────────────────┐
│ GitHub連携                                          │
├─────────────────────────────────────────────────────┤
│ ステータス: ✅ 連携済み                              │
│ アカウント: mycompany                               │
│ 連携日: 2024-02-01                                  │
│                                                     │
│ [連携を解除] [GitHubで設定を変更]                    │
├─────────────────────────────────────────────────────┤
│ 連携リポジトリ (3)                                  │
│ ┌─────────────────────────────────────────────────┐ │
│ │ mycompany/frontend     main    Private         │ │
│ │ mycompany/backend      main    Private         │ │
│ │ mycompany/docs         main    Public          │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ [GitHubでリポジトリを追加]                          │
└─────────────────────────────────────────────────────┘

未連携の場合:
┌─────────────────────────────────────────────────────┐
│ GitHub連携                                          │
├─────────────────────────────────────────────────────┤
│ GitHubと連携して、PRとタスクを自動で紐付けできます。 │
│                                                     │
│ [GitHubと連携する]                                  │
└─────────────────────────────────────────────────────┘
```

**依存関係:** Phase 3完了後

### 4.2 Space GitHub設定
**ファイル:** `src/app/(internal)/[orgId]/project/[spaceId]/settings/github/page.tsx`

**目的:** Space にリポジトリを紐付け

**UI:**
```
┌─────────────────────────────────────────────────────┐
│ GitHub連携 - クライアントA プロジェクト              │
├─────────────────────────────────────────────────────┤
│ 連携リポジトリ                                      │
│ ┌─────────────────────────────────────────────────┐ │
│ │ ☑ mycompany/frontend   [PR同期: ON]  [解除]    │ │
│ │ ☑ mycompany/backend    [PR同期: ON]  [解除]    │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ リポジトリを追加:                                   │
│ ┌─────────────────────────────────────────────────┐ │
│ │ [▼ mycompany/docs                        ]      │ │
│ └─────────────────────────────────────────────────┘ │
│ [追加]                                              │
└─────────────────────────────────────────────────────┘
```

**依存関係:** 4.1完了後

---

## Phase 5: フロントエンド - タスク連携表示

### 5.1 タスク Inspector に PR 表示
**ファイル:** `src/components/task/TaskInspector.tsx` （既存ファイル修正）

**目的:** タスク詳細に関連PRを表示

**UI追加:**
```
┌─────────────────────────────────────────────────────┐
│ TP-042: ログイン画面のバリデーション                 │
├─────────────────────────────────────────────────────┤
│ ... 既存の詳細 ...                                  │
├─────────────────────────────────────────────────────┤
│ 🔗 関連PR                                           │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 🟢 #123 feat: バリデーション追加                 │ │
│ │    Open • mycompany/frontend • 2h ago          │ │
│ └─────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 🟣 #118 fix: エラーメッセージ修正               │ │
│ │    Merged • mycompany/frontend • 3d ago        │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ [+ PRを手動で紐付け]                                │
└─────────────────────────────────────────────────────┘
```

**依存関係:** Phase 4完了後

### 5.2 PR 状態バッジコンポーネント
**ファイル:** `src/components/github/PRBadge.tsx`

**目的:** PR の状態を視覚的に表示

```typescript
interface PRBadgeProps {
  state: 'open' | 'closed' | 'merged'
  prNumber: number
  prUrl: string
  title: string
  repoName: string
  updatedAt: string
}
```

**色分け:**
- open: 緑 (Green-500)
- closed: 赤 (Red-500)
- merged: 紫 (Purple-500)

**依存関係:** 5.1と並行

### 5.3 useTaskGitHubLinks フック
**ファイル:** `src/lib/hooks/useTaskGitHubLinks.ts`

**目的:** タスクに紐付くPR一覧を取得

```typescript
export function useTaskGitHubLinks(taskId: string) {
  return useQuery({
    queryKey: ['task-github-links', taskId],
    queryFn: async () => {
      const { data } = await supabase
        .from('task_github_links')
        .select(`
          id,
          link_type,
          github_pull_requests (
            id,
            pr_number,
            pr_title,
            pr_url,
            pr_state,
            author_login,
            updated_at,
            github_repositories (
              full_name
            )
          )
        `)
        .eq('task_id', taskId)

      return data
    }
  })
}
```

**依存関係:** なし

---

## Phase 6: テスト

### 6.1 Webhook 署名検証テスト
**ファイル:** `src/lib/github/__tests__/webhook.test.ts`

### 6.2 タスクID検出テスト
**ファイル:** `src/lib/github/__tests__/task-linker.test.ts`

**テストケース:**
```typescript
describe('タスクID検出', () => {
  it('#TP-001 形式を検出', () => {
    expect(extractTaskIds('fix: ログイン修正 #TP-001')).toEqual(['TP-001'])
  })

  it('TP-001 形式を検出', () => {
    expect(extractTaskIds('TP-042 対応')).toEqual(['TP-042'])
  })

  it('[TP-001] 形式を検出', () => {
    expect(extractTaskIds('[TP-001] バグ修正')).toEqual(['TP-001'])
  })

  it('複数のタスクIDを検出', () => {
    expect(extractTaskIds('#TP-001 #TP-002')).toEqual(['TP-001', 'TP-002'])
  })

  it('重複を除去', () => {
    expect(extractTaskIds('#TP-001 TP-001')).toEqual(['TP-001'])
  })
})
```

**依存関係:** Phase 3完了後

---

## 実装順序サマリー

```
Phase 1: DB準備 (1.1)
    ↓
Phase 2: GitHub App設定 (2.1 → 2.2)
    ↓
Phase 3: API実装 (3.1, 3.2 並行 → 3.3 → 3.4)
    ↓
Phase 4: 設定UI (4.1 → 4.2)
    ↓
Phase 5: タスク連携UI (5.3 → 5.1, 5.2 並行)
    ↓
Phase 6: テスト (6.1, 6.2 並行)
```

---

## 今後の対応予定（Phase 2以降）

### 過去データインポート（Upstash QStash）
- インポートジョブテーブル追加
- QStash によるキュー処理
- 進捗表示UI
- スコープ選択（過去90日/1年/全期間）

### GitHub Issues 同期
- Issues テーブル追加
- Issue → タスク変換

### PRマージ時の自動アクション
- タスクステータス自動更新
- ボール移動

---

## 見積もり

| Phase | 内容 | 工数 |
|-------|------|------|
| 1 | DB準備 | 1-2h |
| 2 | GitHub App設定 | 1h |
| 3 | API実装 | 4-6h |
| 4 | 設定UI | 3-4h |
| 5 | タスク連携UI | 2-3h |
| 6 | テスト | 2h |
| **合計** | | **13-18h** |

---

## セキュリティ対策（Codex Code Review後の修正）

### 修正済み項目

#### 1. OAuth State CSRF対策
**問題:** state パラメータが署名なしで、CSRF攻撃に脆弱だった

**修正:**
- `src/lib/github/config.ts` に `createSignedState()` / `verifySignedState()` を追加
- HMAC-SHA256 で署名、15分の有効期限を設定
- `src/app/api/github/callback/route.ts` で署名検証を実施

```typescript
// 署名付きstate生成
export function createSignedState(orgId: string, redirectUri: string): string {
  const payload = JSON.stringify({ orgId, redirectUri, ts: Date.now() })
  const signature = createHmac('sha256', GITHUB_CONFIG.stateSecret)
    .update(payload).digest('hex')
  return Buffer.from(JSON.stringify({ payload, signature })).toString('base64url')
}

// 署名検証（15分有効期限）
export function verifySignedState(state: string): { orgId: string; redirectUri: string } | null
```

**環境変数追加:**
```env
GITHUB_STATE_SECRET=xxxxxxxxxxxx  # 任意、未設定時はWEBHOOK_SECRETを使用
```

#### 2. github_webhook_events RLS有効化
**問題:** Webhookイベントログテーブルに RLS が無効だった

**修正:** `supabase/migrations/20240205_001_github_security_fixes.sql`
```sql
alter table github_webhook_events enable row level security;

create policy "org owners can view webhook events"
  on github_webhook_events for select
  using (org_id in (
    select org_id from org_memberships
    where user_id = auth.uid() and role = 'owner'
  ));
```

#### 3. クロス組織リポジトリリンク防止
**問題:** 異なる組織のリポジトリを Space に紐付け可能だった

**修正（アプリケーション側）:** `src/app/api/github/spaces/route.ts`
```typescript
// リポジトリが同じ組織に属しているか検証
if (repo.org_id !== space.org_id) {
  return NextResponse.json(
    { error: 'Repository belongs to a different organization' },
    { status: 403 }
  )
}
```

**修正（DB側）:** トリガー関数で二重チェック
```sql
create or replace function check_space_repo_org_match()
returns trigger as $$
  -- Space と Repository の org_id が一致するか検証
$$
```

#### 4. task_github_links RLS強化
**問題:** org_membershipベースの広すぎる権限設定

**修正:** Space メンバーシップベースに変更
```sql
-- Space メンバーのみ閲覧可能
create policy "space members can view task links" on task_github_links for select
  using (task_id in (
    select t.id from tasks t
    join space_memberships sm on sm.space_id = t.space_id
    where sm.user_id = auth.uid()
  ));

-- Space editor/admin のみ作成可能
-- リンク作成者または Space admin のみ削除可能
```

#### 5. タスクID正規表現改善
**問題:** 単語境界がなく誤検出の可能性があった

**修正:** `src/lib/github/task-linker.ts`
```typescript
// Before: /(?:#?|\[)(TP-\d+)(?:\])?/gi
// After: 単語境界を使用
const TASK_ID_PATTERN = /(?:^|[\s\[\(#])(?:#?)(TP-\d+)(?:[\]\)\s,.:;]|$)/gi
```

### 残作業（推奨事項）

| 項目 | 優先度 | 説明 |
|------|--------|------|
| N+1クエリ最適化 | Medium | タスクリンク処理のバッチ化 |
| リポジトリ取得ページネーション | Low | 大量リポジトリ対応 |
| インストール削除時のカスケード処理 | Medium | 孤立データ防止 |
| 管理者による自動リンク削除 | Low | 誤リンク修正用 |
