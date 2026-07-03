# RLS ステージ: ベンダー可視範囲の細粒度化（V3 確定設計）

由来: UXレビュー #90 / 調査 `docs/notes/SECURITY_vendor-authz_findings.md`。
位置づけ: `docs/spec/RLS_ROLLOUT_SPEC.md` の Stage 1（`app_can_access_space` によるスペース単位・粗粒度）に対する**細粒度化ステージ**。Stage 1 が「後続 migration で締める」と明記した部分。
検証: 本設計は Security Analyst(GPT) のアドバイザリレビュー済み（下記「レビュー反映」）。
ステータス: **設計確定・実装未着手**。実装は本ステージのガバナンス（migration-writer 量産＋グループ別レビュー＋ドライラン、boundary は Fable サインオフ）に載せる。

---

## 1. 問題（V3）

現状 `tasks_select_member` は `app_can_access_space(space_id, org_id)` のみで、**client/vendor は自スペースの全タスクが見える**（`client_scope`・`ball` 不問）。第三者ベンダー（制作会社）に、エージェンシーの社内専用タスク・クライアント対応スレッド・（子テーブル経由で）**利益率/売値**まで露出しうる。ベンダーポータルはユーザーJWT（authenticated）で読むため RLS が効く＝RLS で締められる。

## 2. 確定した可視性マトリクス（tasks 行の SELECT）

| 呼び出し元 | 可視範囲 |
|---|---|
| 内部メンバー（org_memberships: owner/admin/member） | スペース内全タスク（現状維持・無影響） |
| **クライアント**（外部・非vendor） | `client_scope='deliverable'` のみ（**全ball**。client-ball＝自分の番は見せる） |
| **ベンダー**（space_memberships role='vendor'） | `client_scope='deliverable'` **かつ ball ≠ 'client'**（client対応スレッドは機密として隠す） |

- client と vendor を**区別する**必要がある（client-ball の扱いが逆）。既存 `app_is_org_internal` だけでは不足 → 新ヘルパ `app_is_space_vendor(p_space)` を追加。
- NULL `client_scope` は `= 'deliverable'` の三値論理で**fail-closed（外部に非表示）**＝安全既定。`coalesce(client_scope,'deliverable')` は**禁止**。

## 3. レビュー反映（Security Analyst 検証結果）

案A（SELECT を deliverable に絞る）**だけでは leak-free ではない**。以下を同ステージで締める：

### 3-1. WRITE も締める（重大）
`tasks` の UPDATE/DELETE も現状粗粒度。ベンダーが既知IDの隠しタスクを更新（`client_scope` を deliverable に書換）・削除しうる。→ UPDATE/DELETE の `USING`/`WITH CHECK` も可視性ヘルパで narrowing、かつ列レベル書換ガード（既存 `guard_*` トリガ様式）。

### 3-2. 子テーブルの波及（重大）
`tasks` を締めても以下は親タスク可視性チェックが無いと `space_id`/既知 `task_id` で直接漏れる：
- **`task_pricing`（最優先）**: margin/sell/クライアント承認列をベンダーに見せない・書かせない（既存 `20260308_003_task_pricing_write_guard` を拡張）
- `task_comments`（`internal`/`agency_only` 可視性をベンダーから隠す）
- `task_events` / `task_owners` / `reviews` / `task_publications` / `task_relations`（relations は両端タスク可視が条件）
- `meetings`/transcripts/participants（ベンダー招待分のみ）、`wiki_pages`/versions（ベンダー公開分のみ）、`milestones`（要判断・名称/日付が戦略を漏らしうる）

### 3-3. SECURITY DEFINER RPC の迂回
pass-ball / spec / review / task-pricing 等の RPC は RLS を迂回。各 RPC 内でも同じ可視性/書込ヘルパを適用。

### 3-4. その他
- **org/space 整合**: ヘルパは行の `org_id`/`space_id` を信頼 → `exists(spaces where id=p_space and org_id=p_org)` を足すか複合FKで担保。
- **クライアントポータルの前提を要検証**: `/portal/task/[taskId]` 等 authenticated SSR 読取がある場合、client の RLS 挙動は「無影響」と仮定せず**テスト**する。
- クエリ側 `.eq('client_scope','deliverable')` は defense-in-depth として残すが、**真の境界は RLS/RPC**。

## 4. サインオフ（2026-07-03 確定）
1. **ベンダーから client-ball deliverable を隠す = YES**（機密性優先）。当面は割当ベース例外なし（将来 `vendor_visible` フラグは別途検討）。
2. **`milestones` をベンダーに見せる = YES**（スケジュール共有に必要）。→ milestones は既存の space スコープ RLS のままで可、**本ステージでの変更不要**。
3. **NULL `client_scope` = 外部（client/vendor）に非表示（fail-closed）で確定**。`= 'deliverable'` の三値論理で自然に非表示。既存 agency space の行は「本当に外注/クライアント向けのものだけ deliverable に分類、それ以外は internal」にバックフィルする（`coalesce` 既定 deliverable は禁止）。

## 5. 実装ステージ分割（migration-writer 量産・グループ別レビュー）
- [ ] ヘルパ `app_is_space_vendor(p_space)`（SECURITY DEFINER, space_memberships 直参照）＋ org/space 整合チェック
- [ ] `tasks` SELECT narrowing（マトリクス §2）
- [ ] `tasks` UPDATE/DELETE narrowing ＋列書換ガード
- [ ] `task_pricing` 可視性＋列保護（最優先）
- [ ] `task_comments`/`task_events`/`task_owners`/`reviews`/`task_relations`
- [ ] meetings/wiki/milestones（§4-2 判断後）
- [ ] 関連 SECURITY DEFINER RPC に可視性/書込ヘルパを内包
- [ ] NULL `client_scope` バックフィル（§4-3 確定後）
- [ ] クエリ側 defense-in-depth（`vendor-portal/tasks/page.tsx` ほか）
- 各ステップ: 冪等（drop policy if exists→create）・可逆（rollback 節）・ドライラン（apply-migration.sh の BEGIN→ROLLBACK）。

## 6. 検証ゲート
- ベンダーJWTで `select * from tasks/task_pricing/task_comments...`：`internal`/client-ball/対象外scope が **0件**。
- ベンダーが既知IDの隠しタスクを update/delete/`client_scope`書換：**拒否**。
- 内部メンバー：全件維持（無影響）。クライアント：deliverable かつ client-ball 可視（自分の番が見える）。
- リスク評価（レビュー時点）: **HIGH as proposed** → 上記（write/子テーブル/RPC/backfill/client-ball判断）を締めて初めて acceptable。

---

## 付録A: tasks SELECT narrowing ドラフト（**migrations 外・design 用**）

> 誤適用防止のため `supabase/migrations/` には置かない。migration-writer が本ステージのテンプレ（冪等・可逆・検証・rollback 節）に整形して正式化する。

```sql
-- 新ヘルパ: 呼び出し元が当該スペースの vendor か（SECURITY DEFINER）
create or replace function public.app_is_space_vendor(p_space uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from space_memberships s
    where s.space_id = p_space and s.user_id = auth.uid() and s.role = 'vendor'
  );
$$;

-- tasks SELECT を可視性マトリクスで narrowing
drop policy if exists tasks_select_member on public.tasks;
create policy tasks_select_member on public.tasks
  for select to authenticated
  using (
    app_can_access_space(space_id, org_id)
    and (
      app_is_org_internal(org_id)                              -- 内部: 全件
      or (
        client_scope = 'deliverable'                           -- 外部共通: deliverable のみ
        and (not app_is_space_vendor(space_id) or ball is distinct from 'client')  -- vendor は client-ball 除外
      )
    )
  );
-- rollback: 旧 tasks_select_member（app_can_access_space のみ）へ戻す。drop function if exists app_is_space_vendor(uuid);
```
