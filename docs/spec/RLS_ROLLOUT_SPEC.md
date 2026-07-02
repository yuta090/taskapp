# RLS 導入ロールアウト設計（マルチテナント境界の確立）

> ステータス: **設計（Fable 5）** / 対象: 本番 `bbkguncomaizevkgxkwx`
> 背景: 監査により、コアテーブル30個が **RLS無効・ポリシー0件**、かつ `anon`（公開キー）に
> SELECT/INSERT/UPDATE/DELETE/TRUNCATE 全権があることを本番で確定。＝**認証ゼロで全テナントのデータが露出**。

## 0. 確定した実状態（本番実測）

- RLS有効: 周辺28テーブルのみ（api_keys, profiles, audit_logs, scheduling_*, slack_*, github_* 等）。
- RLS無効・ポリシー0: コア30テーブル（tasks, organizations, org_memberships, space_memberships, spaces, invites, reviews, milestones, meetings, notifications, task_owners, task_pricing, wiki_pages, meeting_transcripts, review_approvals, … 下記対象一覧）。
- `anon` / `authenticated` ともに上記に対し **DELETE/INSERT/SELECT/TRUNCATE/UPDATE**。
- 全テーブルに `org_id` を保持（`space_memberships` は `space_id`、`organizations`/`spaces`/`plans` は例外）。`space_id` の有無で org/space スコープに二分可能。

## 1. アクセスモデル（設計の土台・実コード確認済み）

| 経路 | ロール | RLSの影響 |
|---|---|---|
| ブラウザ hooks（`createBrowserClient`、useTasks 等が `tasks` 等を直読み） | `authenticated`（JWT） | **受ける** → メンバーシップベースのポリシーが必須 |
| Server Components（`@/lib/supabase/server`、ユーザーcookie） | `authenticated` | 受ける |
| 公開ページ（`/`, `/pricing`, `/invite/[token]` 等） | `anon` | coreテーブルを**直読みしない**（invite等は SECURITY DEFINER RPC 経由） |
| API routes（`@/lib/supabase/admin`、service_role） | `service_role` | **バイパス**（サーバ経路は影響なし） |

**結論**: `anon` はコアテーブルへの直接権限が不要。`authenticated` は「自分が属する org/space の行だけ」に絞る必要がある。`service_role` は据え置き。

## 2. ロール別の到達目標

- `anon`: コアテーブルへ **一切アクセス不可**（REVOKE ALL）。anon経路は SECURITY DEFINER RPC のみ。
- `authenticated`: SELECT/INSERT/UPDATE/DELETE は保持するが **RLSで自テナントの行に限定**。**TRUNCATE/REFERENCES/TRIGGER は剥奪**（TRUNCATEはRLSで防げないため必須）。
- `service_role`: 変更なし（RLSバイパス）。

## 3. 段階的ロールアウト（失敗コストを抑える順序）

### Stage 0 — 権限ハードニング（低リスク・即時可逆・最大効果）
`migration: 20260703_000_rls_stage0_grants.sql`
- `anon` から対象30テーブルの権限を全剥奪。
- `authenticated` から TRUNCATE/REFERENCES/TRIGGER を剥奪。
- `plans`（参照マスタ）は SELECT のみ残し書き込み剥奪。
- **効果**: 「インターネット上の誰でも公開キーで全データ吸い出し/破壊」という最悪ベクトルと TRUNCATE 破壊を即封鎖。
- **アプリ影響**: 低（authenticated経由の挙動は不変、公開ページは直読みしない）。
- **可逆性**: 高（GRANT を戻すだけ、数秒）。
- **検証**: 適用後に **anonキーで `GET /rest/v1/tasks` を叩き、permission denied を確認**（穴が塞がった証跡）＋アプリのスモークテスト（ログイン→タスク表示→portal）。

> ⚠️ Stage 0 は「未認証の公開露出」を閉じるが、**ログイン済みユーザーによる越境（org A の人が org B を読む）IDOR は Stage 1 まで残る**。ただし攻撃可能範囲は「インターネット全員」→「認証済み顧客」へ大幅縮小。

### Stage 1 — RLSポリシー（authenticated の越境IDORを閉じる／慎重）
`migration: 20260703_001_rls_helpers.sql`（ヘルパ）＋ グループ別ポリシー migration 複数

#### 1-a. ヘルパ関数（再帰回避のため SECURITY DEFINER）
```sql
create or replace function public.app_is_org_member(p_org uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from org_memberships m
                where m.org_id = p_org and m.user_id = auth.uid()); $$;

create or replace function public.app_is_org_internal(p_org uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from org_memberships m
                where m.org_id = p_org and m.user_id = auth.uid()
                  and m.role in ('owner','admin','member')); $$;

create or replace function public.app_is_space_member(p_space uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from space_memberships s
                where s.space_id = p_space and s.user_id = auth.uid()); $$;

-- 内部メンバーはorg内全スペース可、client/vendorは自スペースのみ
create or replace function public.app_can_access_space(p_space uuid, p_org uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select public.app_is_space_member(p_space) or public.app_is_org_internal(p_org); $$;
```
- **再帰回避**: これらは SECURITY DEFINER（定義者=postgres）でメンバーシップ表を参照。membershipテーブルのポリシーはヘルパを呼ばず `user_id = auth.uid()`（自分の行）＋ definer関数のみで表現し、**policyがpolicyを呼ぶ循環を作らない**。
- **検証ゲート#1**: 適用後、authenticated として `select * from space_memberships` を実行し **無限再帰(42P17)が出ないこと**を確認。

#### 1-b. ポリシー雛形（スコープ別）
- **org スコープ**（organizations, org_billing, space_groups, discussion_comments, onboarding_progress, llm_runs）:
  `using ( app_is_org_member(org_id) )` / write は `app_is_org_internal(org_id)`。`organizations` は `id` を org_id とみなす。`org_billing`/課金系の write は owner/admin 限定を検討。
- **space スコープ**（tasks, spaces, milestones, meetings, notifications, task_owners, task_pricing, task_events, task_relations, reviews, wiki_pages, mcp_confirm_tokens, discussion_items, meeting_participants）:
  `using ( app_can_access_space(space_id, org_id) )`。`spaces` は `id` を space_id とみなす。
- **親参照スコープ**（review_approvals→reviews, meeting_transcripts/meeting_drafts→meetings, task_publications→tasks, milestone_publications/wiki_page_publications/wiki_page_versions→org）:
  org_id を保持しているので当面 `app_is_org_member(org_id)` で anchor（粒度が粗いが安全側）。将来 space 粒度に締める。
- **membership**（org_memberships, space_memberships）:
  SELECT: `user_id = auth.uid()`（自分）＋（同org/space内の可視性が必要なら definer関数で）。write は内部管理者/RPC経由に限定。
- **invites**（機微・トークン）: SELECT は org 内部管理者のみ。トークン検証は既存 `rpc_validate_invite`（SECURITY DEFINER）に一本化（anonはRPCのみ）。
- **client/vendor の write 制限**: client ロールは自スペースでも create/update できる範囲を要件に合わせて限定（例: リクエスト作成は可、他者タスクの改変は不可）。→ 要件確認事項。

#### 1-c. 適用順（グループごとに検証）
1. helpers → 2. membership表 → 3. tasks 単体（最重要・動線が濃い）で全機能スモーク → 4. 残り space スコープ → 5. org スコープ → 6. 親参照スコープ → 7. invites。
各グループで `apply-migration.sh` のドライラン（BEGIN→ROLLBACK）でSQL検証 → 適用 → アプリ主要動線テスト。1グループでも破綻したら該当テーブルを `disable row level security` で即ロールバック。

### Stage 2 — 付随（構造#2/#3）
- **DEFINER RPC の認可ヘルパ**: `rpc_pass_ball`/`rpc_review_approve`/`rpc_review_block`/`rpc_meeting_start`/`rpc_set_spec_state` に `app_can_access_space` 検証を追加（`rpc_review_open` と同型）。全 DEFINER 関数に `set search_path=public`、`revoke execute from anon`（必要roleのみgrant）。
- **notify-approval のトークン発行認可**: `spaceId` を body でなく task から導出＋呼び出し元のメンバーシップ検証。

## 4. ロールバック方針
- Stage 0: 剥奪した GRANT を戻す（`grant ...`）。
- Stage 1: `alter table <t> disable row level security;` または `drop policy`。RLSはオン/オフが即時・可逆。
- 全migrationは `apply-migration.sh`（単一トランザクション／ドライラン先行）で適用し、破壊的操作は含めない。

## 5. 検証ゲート（本番反映の必須条件）
1. helpers 適用後、`space_memberships` の再帰(42P17)が出ない。
2. tasks にRLS適用後、内部ユーザーは全スペース、clientは自スペースのみ見える（越境が消える）。
3. anonキーで core テーブルへアクセス→ permission denied。
4. service_role（API routes）は従来通り動作。
5. 主要動線スモーク（ログイン/タスクCRUD/レビュー/会議/portal/招待）が全緑。

## 6. 実行体制（モデル振り分け）
- 本設計・段階順・検証ゲート・再帰回避=**Fable**（本書）。
- Stage 0 適用と anon-probe 検証=Fable監督下で即実行（低リスク）。
- Stage 1 の各グループ policy SQL 量産=**migration-writer(Opus)**（本書の雛形に従い、グループごとにレビュー＆ドライラン）。
- スモークテスト自動化=**impl-runner(Sonnet)** で e2e 追加。
