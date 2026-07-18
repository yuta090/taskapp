# AI秘書 Stage 2.7 / 2.8 — 責任者確認によるタスク昇格 と 1日のまとめ（有料オプション）

Status: Draft v2（Codex Architect + Plan Reviewer の指摘を反映）
Date: 2026-07-14
決定者: メイン(Opus)。Codex(Architect / Plan Reviewer) で相互検証済み。
※ 本来 Fable 級（承認の本人性・課金境界・不可逆スキーマ）だが Fable のクレジット枯渇により Opus が決定。回復後に Fable 再検証を推奨。

---

## 0. 要望（2026-07-14 オーナー）

1. **1日のまとめ**（会話の要約）を**有料オプション**として提供したい
2. 会話から抽出したタスク候補を、**責任者に確認してから**本体タスクへ登録したい
3. 確認は**責任者の1:1 LINEトーク**で行いたい

Stage 2.6（`AI_SECRETARY_STAGE2_6_DUE_ASSIGNEE.md:199-208`）で保留された「digest に溜める → 確認 → 本体タスク化」が本仕様の対象。

---

## 1. 壊してはならない既存の不変条件

| # | 不変条件 | 根拠 |
|---|---|---|
| I-1 | `channel_messages` は append-only（トリガー強制） | `20260710204722_channel_plumbing.sql` |
| I-2 | グループ発言の `space_id` は**グループ由来のみ**。identity から導出しない | `webhookHandler.ts:416` |
| I-3 | digest 抽出は水位 `channel_groups.last_extracted_message_created_at` で exactly-once | `rpc_ingest_digest_tasks` |
| I-4 | **LLM に push 全文を書かせない**。本文はサーバ側テンプレート合成のみ | `digest/compute.ts:6-12` |
| I-5 | `channel_identities` は `space_id` 必須の「顧問先の窓口」。`profiles` とは別軸 | `AI_SECRETARY_STAGE2_6_DUE_ASSIGNEE.md:203-204` |
| I-6 | `ball='client'` ⟹ `client_scope='deliverable'`（DBトリガー強制） | `20260706003903_ball_client_scope_invariant.sql` |
| I-7 | 承認系は**二重実行で副作用ゼロ**（HTTPコードは §3-6 の規約に従う） | `email-action/[token]/route.ts` |

### 1-1. 調査で判明した事実（設計が依拠してはならない／必ず考慮する）

- **`channel_digest_tasks.status` の変更は外部sink（Notion/Sheets/Webhook）へ即時 enqueue される**（`20260711121910_integration_sinks.sql` の enqueue トリガー）。
  → **グループの「完了N」は可逆ではない**。24hの undo 窓があっても外部配信は取り消せない。「可逆だから本人性不要」という論拠は**成立しない**（§3-2）。
- **`tasks.client_scope` の DB 既定値は `'deliverable'`（＝顧客に見える）**。`'internal'` 化はアプリ層（`useTasks.ts:273`）でしか行われていない。
  → **`useTasks` を通さない RPC 経由の INSERT は既定で顧客に見えるタスクを作る**。昇格RPCは `client_scope` を明示必須。
- **`client_scope` を追加する DDL が `supabase/migrations/` に無い**。定義は `docs/db/DDL_v0.5_client_scope.sql` のみ（本番へは手動適用済み）。
  → **migrations から作るテストDBに列が無く、昇格のテストが書けない**。§2（PR0）で解消する。
- **`tasks` の必須列**: `org_id` NOT NULL / `space_id` NOT NULL / `title` NOT NULL / `status` NOT NULL（既定なし）/ `created_by` NOT NULL / `description` NOT NULL default ''。**`due_time` 相当の列は存在しない**（`20240101_000_schema.sql:86-110`）。
- **`inboundTextRecord()` は受信本文を平文で `channel_messages` に保存する**（`webhookHandler.ts:316-341`）。append-only なので**認証コードは保存前にマスクしなければ永久に残る**。
- **room イベントは `events.ts:184` で破棄されている** → room 経由のコードは webhook に届かない。room の失効処理は**不要**。
- **`confirmation_request` 通知は「発行元だけ無い空き枠」ではない**。既存UI（`NotificationInspector.tsx:515`）は日程調整リンクとして扱うだけで、タスク化・却下の操作は無い。**アクションパネルの新規実装が必要**。

---

## 2. PR0 — ベースライン整備（前提。これ無しでは TDD が回らない）

`docs/db/DDL_v0.5_client_scope.sql` の内容を、冪等な migration として `supabase/migrations/` に取り込む。

### 2-1. ファイル名は**既存の最初の参照より前にソートされる**必要がある（P0）

既存 migration が `client_scope` を**参照している**:
- `20260703_010_rls_vendor_task_scope.sql:83`（RLSポリシー）
- `20260706003903_ball_client_scope_invariant.sql:92`（RPC）

現在時刻のファイル名で末尾に足すと、**空DBの再構築はこれらの手前で落ちる**。よって:

- ファイル名: **`20260101000000_baseline_client_scope.sql`**
- ソート順: `20240101_000_schema.sql`（tasks 作成）< **`20260101000000_...`** < `20260703_010_...`（最初の参照）を満たす。
- **本migrationは「命名は `YYYYMMDDHHMMSS`」の規約に従いつつ、順序制約のため過去日時を用いる**例外である（理由をファイル冒頭コメントに明記する）。

```sql
-- 20260101000000_baseline_client_scope.sql
-- 既存本番DBには DDL_v0.5 として手動適用済み。履歴整合とテストDB再現性のために取り込む。
-- ファイル名の日時が過去なのは、20260703_010 / 20260706003903 が本列を参照するため、
-- それらより前にソートされる必要があるから（現在時刻にすると空DB再構築が失敗する）。
alter table public.tasks add column if not exists client_scope text
  not null default 'deliverable'
  check (client_scope in ('deliverable','internal'));
create index if not exists tasks_client_scope_idx on public.tasks(client_scope);
create index if not exists tasks_portal_query_idx on public.tasks(space_id, ball, client_scope, status);
```

本番には適用済みのため `if not exists` で no-op。

### 2-2. 受け入れ条件

- [x] ファイル名のソート順が `20240101_000_schema.sql` < `20260101000000_baseline_client_scope.sql` < `20260703_010_...`（最初の参照）を満たす
- [x] スクラッチDBで `tasks` 作成 → 本migration適用 → `client_scope` が存在し既定が `'deliverable'`・NOT NULL
- [x] 冪等（2回適用しても no-op）
- [x] CHECK制約が不正値を拒否する

### 2-3. 【発見】migrations は現状も空DBから再構築できない（本仕様の対象外・既存破綻）

当初「migrations だけから空DBを再構築できること」を受け入れ条件に置こうとしたが、**client_scope 以前に別の破綻がある**ことが判明した:

- `github_pull_requests` が **列構成の異なる状態で二重定義**されている
  - `20240101_000_schema.sql:587`（`repo_id bigint`）
  - `20240205_000_github_integration.sql:65`（`github_repo_id uuid`）
  - `create table if not exists` のため2つ目が**黙って無視され**、直後の `create index ... (github_repo_id)` が落ちる
- 本番では先に走った方が勝っているため、**後続 migration の想定と本番実スキーマが食い違っている可能性がある**

これは本仕様の作業以前から存在する破綻であり、全て直すのは機能開発のスコープを超える。**§8 の宿題に記録し、本仕様では既存の「最小スキーマをスクラッチDBに建てて検証する」方式**（`supabase/tests/rls_vendor_task_scope_verify.sql` の流儀）に従う。

検証ツールは本PRで用意する（既存破綻の可視化にも使える）:
- `supabase/tests/_local_bootstrap.sql` — auth スキーマ／ロールの最小スタブ
- `scripts/verify-migrations-from-scratch.sh` — 空DBへ先頭から適用し、最初に落ちる migration を報告する

---

## 3. Stage 2.7-A — 内部ユーザーの LINE 本人紐付け（PR1）

### 3-1. 決定

新テーブル `channel_user_links` で内部ユーザー（`auth.users`）と LINE userId を**本人単位**で結ぶ。

**却下**:
- `channel_identities` への相乗り（`user_id` 追加＋`space_id` nullable化）→ I-5 / I-2 を壊す。不可逆。
- 既存 `channel_link_codes`（30日マルチユース）の流用 → **意図的にワンタイムでない**（「紙/QRを社長と経理の2人が読む運用」`20260710204722:111-112`）。本人性に使えない。
- LINE Login OAuth → 本人性は最強だが第一弾には重い。`linked_via` 列で後日差し替え可能にする。

### 3-2. スキーマ

```sql
create table public.channel_user_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('line')),
  channel_account_id uuid not null references channel_accounts(id) on delete cascade,
  external_user_id text not null,
  linked_via text not null check (linked_via in ('code','line_login')),
  linked_at timestamptz not null default now(),
  revoked_at timestamptz null,
  revoked_by uuid null references auth.users(id)
);
-- active = revoked_at is null（status列は持たない＝矛盾状態を作らない）
create unique index channel_user_links_active_external
  on channel_user_links(org_id, channel_account_id, external_user_id) where revoked_at is null;
create unique index channel_user_links_active_user
  on channel_user_links(org_id, channel_account_id, user_id) where revoked_at is null;

create table public.channel_user_link_codes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_account_id uuid not null references channel_accounts(id) on delete cascade,
  code_hash text not null,                     -- sha256。平文は保存しない
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  used_at timestamptz null,
  created_at timestamptz not null default now()
);
create unique index channel_user_link_codes_hash
  on channel_user_link_codes(code_hash) where used_at is null;

-- 試行制限は外部userId単位の履歴で行う（コード行の attempt_count では窓を表現できない）
create table public.channel_user_link_attempts (
  id uuid primary key default gen_random_uuid(),
  channel_account_id uuid not null references channel_accounts(id) on delete cascade,
  external_user_id text not null,
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);
create index channel_user_link_attempts_window
  on channel_user_link_attempts(channel_account_id, external_user_id, attempted_at desc);
```

`channel_user_links` / `channel_user_link_codes` は **RLS 有効＋ポリシー無し**（service_role のみ。`email_action_tokens` と同じ流儀）。

### 3-3. コードの形式と保存前マスク（P0）

- 内部ユーザー用コードは**顧客用（`channel_link_codes`）と形式を分ける**: `TA-` + Crockford Base32 26文字（128bit）。
- **平文はDBに保存しない**。発行APIのレスポンスで一度だけ返す。DBには `sha256(code)` のみ。
- **`channel_messages` へ保存する前にマスクする**: 本文が内部コード形式に一致したら `body` を `'[認証コード]'` に置換して保存する（I-1 により、入れてしまうと消せない）。
- ログ・エラー監視にもコード文字列を出さない。

### 3-4. 消費プロトコル（単一トランザクション・**例外を投げない**）

`rpc_consume_user_link_code(p_code_hash, p_channel_account_id, p_external_user_id)` に**すべてを閉じ込める**。

**戻り値は列挙型（例外を投げない）**:
```
returns table (status text, link_id uuid)
-- status ∈ ('ok','invalid','expired','locked','conflict')
```

**例外を投げてはならない理由（P0）**: RPC が例外を送出すると**同一トランザクション内の試行履歴 INSERT もロールバックされ、試行制限が機能しなくなる**。失敗も正常な戻り値として返し、履歴をコミットする。

**手順**:
1. **直列化**: `pg_advisory_xact_lock(hashtext(p_channel_account_id::text || ':' || p_external_user_id))` を取る。これが無いと**同時リクエストが全員「5回未満」を観測して制限を突破する**。
2. **試行制限チェック**: 直近10分の `channel_user_link_attempts` で `succeeded=false` が **5件以上なら `('locked', null)` を返す**。
   - **このとき試行行を追加しない**（追加すると窓が自動延長され、永久ロックになる）。
   - 結果として、ロックは**5回目の失敗から10分後に自然解除**される。別途 `locked_until` 列は持たない。
3. **CAS 消費**: `update ... where code_hash=$1 and used_at is null and expires_at > now() returning *`。0行なら試行を `false` で記録して `('invalid', null)`（期限切れは `('expired', null)`）。
4. **束縛検証**: コード行の `org_id` / `channel_account_id` が引数と一致すること（他org・他OAのコードは成立させない）。不一致は `('invalid', null)`。
5. **リンク作成**: `channel_user_links` を INSERT。
   - 手順3〜5 を **`BEGIN ... EXCEPTION WHEN unique_violation` ブロック（暗黙のセーブポイント）で囲む**。一意制約違反（そのLINEが既に別ユーザーに紐付いている）なら**セーブポイントまでロールバックし、コード消費も取り消す**（コードを無駄にしない）。
   - この場合、外側では試行を `false` で記録して `('conflict', null)` を返す。**試行履歴は残る**（セーブポイントの外なので生き残る）。
6. 成功時は試行を `true` で記録し `('ok', link_id)`。

**1:1トーク（`source.type='user'`）でのみ受理**する。グループから送られた内部コードは紐付けず、**その場で失効させる**（`used_at` を埋める。誤爆でグループに晒されたコードを無効化するため）。room は `events.ts:184` で破棄されるため考慮不要。

### 3-4-1. 権限（3テーブルすべて）

`channel_user_links` / `channel_user_link_codes` / `channel_user_link_attempts` の**すべて**について、既存 `20260710204722_channel_plumbing.sql:284` と同じ流儀で:
- `enable row level security`（ポリシーは作らない）
- `revoke all on <table> from anon, authenticated`（service_role のみ）
- RPC は `security definer` とし、`grant execute` は `service_role` のみ

attempts テーブルは LINE userId を保持するため、links/codes と同じ扱いにする（**RLS だけでなく明示的な REVOKE が必要**）。

### 3-5. 「紐付けはキャッシュに過ぎない」原則

`channel_user_links` に行があることは**認可の十分条件ではない**。承認のたびに同一トランザクション内で再検証する:
- `revoked_at is null`
- 現在も `org_memberships` に在籍
- 現在も対象 space の `space_memberships.role ∈ (admin, editor)`

退職者・権限剥奪者の LINE が承認を通す事故を、失効漏れとは独立に塞ぐ。

### 3-6. UI

秘書コンソールに「自分のLINEを紐付ける」導線（本人のみ・自分の分だけ発行）と、紐付け済み一覧＋revoke ボタン。紐付け成立時に本人へ通知。

### 3-7. 受け入れ条件（TDD）

- [ ] 他人の user_id を指定してコードを発行できない（403）
- [ ] 期限切れコードは紐付かない
- [ ] 使用済みコードは2回目で紐付かない（CAS で0行）
- [ ] 他org の OA に同じコードを送っても紐付かない
- [ ] グループに送られた内部コードは**紐付かず、かつ失効する**
- [ ] 同じLINE userId を2人の内部ユーザーに紐付けられない（一意制約違反 → ロールバックし**コードは未使用のまま**）
- [ ] **1:1にコードを送っても `channel_messages.body` に平文が残らない**（`'[認証コード]'`）
- [ ] 直近10分に5回失敗した外部userIdは `('locked', null)` を返す
- [ ] **ロック中の試行では試行行が追加されない**（窓が延長されず、5回目の失敗から10分後に自然解除される）
- [ ] **RPC は例外を投げない**。失敗ケースでも `channel_user_link_attempts` の行が**コミットされて残る**
- [ ] 一意制約違反（`conflict`）では**コードが未使用のまま残り**、かつ試行履歴は記録される
- [ ] 3テーブルとも `anon` / `authenticated` から読み書きできない（REVOKE 済み）
- [ ] revoke 後は同じLINEで承認できない

---

## 4. Stage 2.7-B — 責任者確認によるタスク昇格（PR2）

### 4-1. 責任者は**グループ単位で1人指定**

```sql
alter table public.channel_groups
  add column approver_user_id uuid null references auth.users(id);
```

- コンソールのグループ設定で内部メンバーから選ぶ。
- **未設定なら候補を `pending` にしない**（`promotion_state='none'` のまま。従来どおり digest に出るだけ）。承認フローは**オプトイン**。
- 選定ロジックを増やさず、要望「責任者に確認」に最も忠実な最小形。

### 4-2. 誰が pending にするか（状態遷移の主体）

| 経路 | 主体 | 遷移 |
|---|---|---|
| 夜間LLM抽出（`pickup_mode='all'`） | `rpc_ingest_digest_tasks` を拡張 | approver 設定済みグループの候補を `pending` + `requested_to_user_id=approver` + `requested_at=now()` で INSERT |
| メンション即時（`pickup_mode='mention_only'`） | `handleMentionInstantTask`（`webhookHandler.ts:773`） | 同上 |
| approver 未設定 | — | `none`（従来動作） |

`space_id` 未紐付けグループの候補は **pending にしない**（承認しても昇格先が無いため）。

### 4-3. 承認できる人と、**2つの認証経路**

承認は LINE と コンソールの2経路から行える。**コンソールには信頼できる `external_user_id` が無いため、LINE用RPCをそのまま流用できない**（P0）。共通ロジックを内部関数に切り出し、**アクター解決だけが異なる薄いラッパを2本**用意する。

```
_promote_digest_task(p_task_id, p_actor_user_id)   -- 内部。認可＋状態機械＋INSERT
  ├─ rpc_promote_digest_task_via_line(p_channel_account_id, p_external_user_id, p_task_id)
  │    → channel_user_links から actor を解決（クライアント由来の user_id は受け取らない）
  └─ rpc_promote_digest_task_via_console(p_task_id)
       → auth.uid() を actor とする
```
`_reject_digest_task` も同じ構成。

**共通の認可条件（両経路）**:
1. 現在も `org_memberships` の内部メンバー
2. 現在も対象 space の `space_memberships.role ∈ (admin, editor)`
3. **その候補の `requested_to_user_id` 本人である**

条件3が無いと「責任者に確認」ではなく「権限を持つ誰かが承認」になる。

**LINE 経路のみの追加条件**:
4. active な `channel_user_links` がある（＝ actor 解決の前提。revoke 済みなら解決不能＝403）

コンソール経路はセッションで認証済みのため条件4は不要（`auth.uid()` が信頼できるアクター）。

### 4-4. グループの「完了N」ボタンについて

**今回は挙動を変えない。ただし「可逆だから安全」という論拠は撤回する。**
§1-1 のとおり完了は外部sinkへ即時配信されるため実際には不可逆である。これは**既存の弱点**であり、修正（未確認完了を `completion_claimed` として扱う／sink に「未確認」と明示する／確認まで配信を遅らせる）は**別PR**に切る（§8）。本PRに混ぜると外部連携の互換性まで巻き込み、過去のPR混在事故を再現する。

### 4-5. スキーマ

```sql
alter table public.channel_digest_tasks
  add column promotion_state text not null default 'none'
    check (promotion_state in ('none','pending','promoted','rejected')),
  add column requested_to_user_id uuid null references auth.users(id),
  add column requested_at timestamptz null,
  add column promoted_task_id uuid null references tasks(id) on delete set null,
  add column confirmed_by_user_id uuid null references auth.users(id),
  add column confirmed_at timestamptz null,
  add column rejected_by_user_id uuid null references auth.users(id),
  add column rejected_at timestamptz null;

alter table public.channel_digest_tasks add constraint digest_promotion_state_chk check (
  (promotion_state = 'none')
  or (promotion_state = 'pending'  and requested_to_user_id is not null and requested_at is not null)
  or (promotion_state = 'promoted' and confirmed_by_user_id is not null and confirmed_at is not null
                                   and requested_to_user_id is not null)
  or (promotion_state = 'rejected' and rejected_by_user_id  is not null and rejected_at  is not null
                                   and requested_to_user_id is not null)
);
```

`promoted_task_id` は `ON DELETE SET NULL`。冪等判定は **`promotion_state='promoted'` が担う**（task が後から削除されても**再作成しない**）。`ON DELETE RESTRICT` は「昇格済みタスクだけ削除不能」という不可逆なUX変更になるため却下。

### 4-6. `rpc_promote_digest_task` — tasks へのコピー値（すべて明示。既定値に頼らない）

`SELECT ... FOR UPDATE` で候補行をロック → §4-3 の4条件を**同一トランザクション内で再検証** → INSERT。

| tasks 列 | 値 | 理由 |
|---|---|---|
| `org_id` | `channel_digest_tasks.org_id` | **NOT NULL**。抜けると INSERT が落ちる |
| `space_id` | `channel_groups.space_id` | **グループ由来のみ**（I-2）。null なら pending にしていない |
| `client_scope` | **`'internal'` 固定** | **DB既定は `'deliverable'`＝顧客に見える**。`origin='client'` は出所であって公開許可ではない |
| `ball` | `'internal'` | 社内が次に動く。`'client'` にすると I-6 で `client_scope` が強制的に `deliverable` になる |
| `origin` | `'client'` | 顧問先グループの会話由来 |
| `type` | `'task'` | |
| `status` | `'todo'` | NOT NULL・既定値なし |
| `created_by` | **承認者の user_id** | NOT NULL |
| `title` | digest の `title`（サニタイズ済み） | |
| `description` | `''` | NOT NULL default '' |
| `due_date` | digest の `due_date` をコピー | |
| `due_time` | **コピーしない** | `tasks` に列が無い。第一弾では落とす（§8 で列追加を検討） |
| `assignee_id` | **NULL** | LINE上の人 ≠ TaskApp ユーザー（I-5） |

`rpc_reject_digest_task` も同じ認可・ロックで `rejected` へ遷移させる。

DB外の副作用（LINE返信・通知）は**コミット後**に行う（トランザクション内で外部I/Oしない）。

### 4-7. 冪等とHTTPコードの規約（統一）

**規約: 同じ終状態を目指す再実行は 200（副作用ゼロ）。矛盾する遷移要求は 409。**

| 状況 | 返り |
|---|---|
| `pending` → 昇格（初回） | 201 / `created=true` |
| `promoted` を再度昇格 | **200** / 既存 `task_id` / `created=false` |
| `pending` → 却下（初回） | 200 |
| `rejected` を再度却下 | **200**（no-op） |
| `promoted` を却下 / `rejected` を昇格 / `space_id` null | **409**（副作用ゼロ） |
| リンク失効・在籍喪失・**依頼先不一致** | **403** |
| 存在しない・他org | 404 |

既存 `task_id` を返す場合も**先に現在の認可を再検証する**（退職者に task UUID を漏らさない）。
※ `email_action_tokens` の「使用済み=410」は**トークン失効**の話で、本規約とは別レイヤ（I-7 の本質は「二重実行で副作用ゼロ」）。

### 4-8. 確認依頼の送付

- 責任者の1:1 LINE へ Flex（「タスク化する」「却下」）を push。宛先は `channel_user_links.external_user_id`。**未紐付けなら push せず、コンソールに「LINE未紐付け」と警告を出す**。
- postback data: `action=digest_promote&task=<uuid>` / `action=digest_reject&task=<uuid>`（既存 `postback.ts` は `digest_done`/`digest_undo` のみなので**パーサを拡張**する）。
- 併せて `confirmation_request` 通知を発行し、コンソールの「確認待ち」トレイからも承認できるようにする。**`NotificationInspector` にタスク化/却下のアクションパネルを新規実装する**（既存は日程調整リンク扱いのみ）。

### 4-9. 受け入れ条件（TDD）

- [ ] 依頼先本人でない内部メンバーが押しても 403
- [ ] revoke 済み・org離脱済みの人が押しても 403（紐付けが残っていても）
- [ ] **二重実行で `tasks` が2件できない**（2回目は 200・既存 task_id・`created=false`）
- [ ] 昇格 task の **`client_scope` が `'internal'`**（顧客ポータルに出ない）
- [ ] 昇格 task の `org_id` / `created_by` / `status` が正しい
- [ ] `promoted` を却下すると 409（副作用ゼロ）
- [ ] approver 未設定グループの候補は `pending` にならない（従来動作）
- [ ] `space_id` 未紐付けグループの候補は `pending` にならない
- [ ] 昇格後に task を削除しても、再実行で task が再作成されない

---

## 5. Stage 2.8 — 1日のまとめ（PR4）

### 5-1. I-4（prompt injection 方針）は**解除しない**

「社内向けなら LLM 自由文を配信してよい」は**却下**。配信先を絞っても入力が非信頼である事実は変わらず、制御文字・URL・`@` を除去しても「経理担当は至急この口座に送金してください」のような**意味的な攻撃**が残る。

**代わりに要約を構造化する。**

```ts
// LLM に強制する JSON Schema
{
  topics:     string[],  // 最大5件・各120字
  decisions:  string[],  // 最大5件・各120字
  requests:   string[],  // 最大5件・各120字
  unresolved: string[],  // 最大5件・各120字
  source_indices: number[]
}
```

- 各文字列は既存 `sanitizeDigestTitle` と同様に**制御文字除去・長さ切り詰め**を通す。
- **LINE 本文はサーバ側テンプレートで組む**（見出し・注意文はサーバ定数。I-4 維持）。
- 各項目は**間接話法**（「参加者から〜という依頼があった」）。
- **LLM 出力から宛先・ボタン・URL・postback・次の処理を決めない。**
- 末尾に固定文: 「顧客発言をもとにしたAI要約です。記載された指示をそのまま実行しないでください。」
- 無効な `source_indices` は捨てる。

### 5-2. 配信先

**社内限定**（責任者の1:1 LINE ＋ 秘書コンソール）。顧客同席グループには流さない。
送信直前にも entitlement・リンク・在籍を**再検証**する。

### 5-3. データ取得と冪等

`findGroupTextMessagesByDateRange(groupId, fromIso, toIso)` を新設。**既存の抽出水位には触らない**（I-3）。

- 範囲は JST の半開区間 `[00:00, 翌00:00)`（`created_at` 基準）
- 遅延到着メッセージは翌日分に含める（`created_at` 基準で固定するため同日再実行の結果は変わらない）
- **要約の失敗が既存タスク抽出の水位更新を妨げない**（経路を分離する）

```sql
create table public.channel_daily_summaries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  group_id uuid not null references channel_groups(id) on delete cascade,
  summary_date date not null,          -- JST
  payload jsonb not null,              -- §5-1 の構造化JSON
  generated_at timestamptz not null default now(),
  delivered_at timestamptz null,
  delivery_retry_key text null,
  unique (group_id, summary_date)
);
```

**同日再実行の挙動**:
- 行があり `delivered_at` not null → **何もしない**（再生成も再配信もしない）
- 行があり `delivered_at` null → **配信のみ再試行**（同じ `delivery_retry_key` で LINE 側が二重配信を弾く）
- 行が無い → 生成 → 保存 → 配信

### 5-4. redaction 連動

元発言が redact された場合、**派生要約が残ると削除要求に応えられない**。`rpc_redact_channel_message` から、当該メッセージを含む日の `channel_daily_summaries` 行を**削除**する（無効化ではなく削除。最も単純）。

### 5-5. 受け入れ条件（TDD）

- [ ] LLM 出力は JSON のみ。壊れた JSON はその日をスキップし、他グループを止めない
- [ ] **LINE 本文に LLM の自由文がそのまま出ない**（見出し・注意文はサーバ定数。payload の各要素は所定スロットにのみ入る）
- [ ] injection 文字列を含む会話でも、出力が構造化JSONの枠を出ない
- [ ] entitlement 無しの org では**生成もされない**（403）
- [ ] 生成後・送信前に entitlement が失効したら**送信されない**
- [ ] 同日2回実行しても LINE へ二重配信されない（`delivered_at` / retry key）
- [ ] 元発言を redact すると、その日の要約行が消える
- [ ] **抽出水位が要約処理で変化しない**

---

## 6. 課金 — entitlement（PR3）

### 6-1. 決定

- `org_entitlements` を新設し `daily_summary` をゲートする。
- **招待制パイロットは手動付与で可。**
- **一般販売時は、プラン名の統一を待たずに `daily_summary` を独立した Stripe Price / subscription item として追加**し、webhook から同じ entitlement 表へ投影する（プラン全面改修より小さい）。
- LP/DB のプラン不一致、`useBillingLimits` スタブ、孤児API は**本PRで触らない**（§8）。

**根拠**: LLM 実行コストは各 org の APIキー持ち（`org_ai_config`）なので、この課金は**コスト転嫁ではなく機能ゲート**。

### 6-2. スキーマと有効判定式

```sql
create table public.org_entitlements (
  org_id uuid not null references organizations(id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default true,
  source text not null check (source in ('manual','stripe')),
  effective_at timestamptz not null default now(),
  expires_at timestamptz null,
  billing_reference text null,     -- 契約/受注/Stripe subscription item
  granted_by uuid null references auth.users(id),
  granted_at timestamptz not null default now(),
  revoked_by uuid null references auth.users(id),
  revoked_at timestamptz null,
  note text null,
  primary key (org_id, feature_key)
);
```

**有効判定（唯一の定義。ここ以外に判定を書かない）:**
```
enabled = true
AND revoked_at IS NULL
AND effective_at <= now()
AND (expires_at IS NULL OR expires_at > now())
```

`enabled boolean` だけでは**未払い利用・支払済み未開通を検出できない**ため、`source` / 期間 / `billing_reference` / 監査列を持たせる。

RLS: service_role のみ書込。読取は org owner。手動付与はシステム管理者または org owner。

### 6-3. ゲートの適用範囲（矛盾の解消）

| 対象 | ゲート |
|---|---|
| 要約の**生成** | **する** |
| 要約の**配信・再送** | **する**（送信直前に再チェック） |
| **過去に生成済みの要約の閲覧** | **しない**（失効後も読める） |

「停止後は新規生成と配信を止めるが、過去の要約は閲覧可能」。

---

## 7. PR 分割（worktree 分離。1ストリーム=1worktree=1ブランチ=1PR）

| # | ブランチ | 内容 | 依存 |
|---|---|---|---|
| 0 | `fix/baseline-client-scope-<ts>` | `client_scope` DDL を migrations に取り込む（冪等） | — |
| 1 | `feat/secretary-user-link-<ts>` | `channel_user_links` / ワンタイムコード / **保存前マスク** / 試行制限 / revoke / コンソールUI | 0 |
| 2 | `feat/secretary-promote-<ts>` | `approver_user_id` / 状態機械 / `rpc_promote_digest_task` / `rpc_reject_digest_task` / postbackパーサ拡張 / 1:1 Flex / 確認待ちトレイ | 1 |
| 3 | `feat/entitlements-<ts>` | `org_entitlements` / `hasEntitlement()` / 手動管理UI / 監査 | 0 |
| 4 | `feat/secretary-daily-summary-<ts>` | 構造化要約 / 日付範囲取得 / 冪等配信 / redaction連動 / 1:1配信 | 1, 3 |

PR4 に課金基盤を混ぜない（障害時に LLM・LINE・課金・UI のどこが原因か切り分けられなくなる）。

**各PR共通の完了条件**: migration は `YYYYMMDDHHMMSS_<topic>.sql`／psql で個別適用し `applied_migrations` に INSERT 記録／Red→Green のテストを先に書く。

---

## 8. 別PRに切る宿題（本仕様の対象外）

- **`supabase/migrations` が空DBから再構築できない**（§2-3）。`github_pull_requests` の二重定義が最初の壁。本番実スキーマとの乖離調査を含む
- **期限切れ・使用済みコードの定期削除**（`channel_user_link_codes` / `channel_user_link_attempts`）。既存 `email_action_tokens` も同じ宿題を抱えている（`docs/EMAIL_APPROVAL_TODO.md:14`）。発行APIにレート制限が無く、認証済みメンバーが行を無制限に増やせるため、まとめて cron で片付ける
- **発行APIのレート制限**（既存の `link-codes` ルートにも無い）。本人分しか発行できないため権限昇格には繋がらないが、行の無制限増加は防ぎたい
- グループの「完了N」を低保証イベントとして扱い、**外部sinkへの不可逆な配信**を是正する（§4-4）
- `org_memberships.role` の CHECK に `admin` が無い（`authz.ts:10` とのズレ）
- `useBillingLimits` スタブ / 孤児API `/api/billing/limits` / LP・DBのプラン不一致
- `tasks` への `due_time` 列追加（申し送りは時刻を持つが tasks が受け取れない）
- LLM 使用量メータリング（`llm_runs` がデッドテーブル、`callLlm` が usage を捨てている）
