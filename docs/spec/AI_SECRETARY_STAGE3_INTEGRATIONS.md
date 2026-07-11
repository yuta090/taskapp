# AI秘書 Stage 3 設計書 — 外部連携（配達先シンク＋請求・見積）

Status: v0.2（2026-07-11 fable-architect 敵対的レビューの差し戻し6件＋裁定4件を反映）
前提: `docs/spec/AI_SECRETARY_DESIGN_v0.1.md`（骨格）/ `AI_SECRETARY_STAGE2_DESIGN.md`（コンソール・グループdigest）/ `CHANNEL_EXPANSION_NOTES.md`（マルチチャネル）

---

## 0. 位置づけと原則

**「秘書が拾う。届け先はあなたの今の道具のまま。」**

Stage 3 は AI秘書が拾った成果（申し送りタスク・受領・承認・請求）を、顧客が既に使っている道具へ**一方向で配達する**レイヤ。汎用ハブ・双方向同期ハブにはしない。

### 原則（不変）

1. **書込方向の一方向原則**: 外部を変更するのは、こちらのイベント配達のみ。**外部の状態でこちらの正本を自動で書き換えない**（読み取り→内部通知→人が確定、は原則に抵触しない。自動反映のみが違反）。双方向同期はやらない。
2. **真実の源はこちら**: `channel_digest_tasks` / `channel_messages` が正本。配達先はビュー。配達失敗してもこちらの状態は変わらない。
3. **回収・催促・証跡エンジンの拡張**: 請求・見積は「お金の回収」＝回収対象の一般化（資料→事実・回答→金銭）。汎用なんでも秘書には寄せない。
4. **配達も証跡**: いつ・どこへ・何を配達し、成功/失敗したかを配達ログとして残す（削除しない）。

### スコープ

| 柱 | 内容 | 実装 |
|----|------|------|
| A. 配達先シンク | 汎用Webhook / Notion / Google Sheets へ task イベントを配達 | **Stage 3 本体** |
| B. 請求・見積（外部連携） | 見積承認→請求ドラフト起票、送付・督促は秘書 | 設計のみ（§6）。実装は需要確認後 |
| C. 自社発行 | 請求書・見積書の自社生成 | **やらない（deferred, §8）** — インボイス法要件を負うため外部連携で需要確認後 |

---

## 1. データモデル

### 1-1. `integration_sinks` — 配達先の台帳

```sql
create table integration_sinks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  -- 配達元のスコープ: org全体 or 特定グループ。NULL = org全体
  group_id uuid,
  provider text not null check (provider in ('webhook', 'notion', 'google_sheets')),
  display_name text not null,
  -- provider別設定（webhook: url / notion: database_id / sheets: spreadsheet_id, sheet_name）
  config jsonb not null default '{}',
  -- webhook: HMAC secret（暗号化）。OAuth系は integration_connections を参照
  secret_encrypted text,
  connection_id uuid references integration_connections(id) on delete set null,
  -- 購読イベント（タイポ＝無音無配達を型で防ぐ）
  events text[] not null default '{task.created,task.done,task.dismissed}',
  status text not null default 'active' check (status in ('active', 'disabled', 'error')),
  consecutive_failures int not null default 0,
  last_delivered_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- org境界保護（Stage 2 と同じ複合FKパターン）
  foreign key (group_id, org_id) references channel_groups(id, org_id),
  -- secret と connection の同居事故を型で防ぐ
  check (
    (provider = 'webhook' and connection_id is null and secret_encrypted is not null)
    or (provider <> 'webhook' and secret_encrypted is null)
  ),
  check (events <@ array['task.created','task.done','task.dismissed','task.reopened']::text[])
);
```

- RLS: internal member SELECT のみ（`app_is_org_internal(org_id)`）。**secret_encrypted は authenticated からは列レベルで不可視**（channel_accounts と同じ revoke+grant select (columns) パターン）。書き込みは service role のみ（API経由）。
- `integration_connections.provider` の check 制約に `'notion'`, `'google_sheets'` を追加。既存の `unique(provider, owner_type, owner_id)` により **org あたり Notion 接続は1ワークスペース**になる（v1 は許容・認識事項）。
- **connection 失効検知時**（token refresh 失敗の確定・revoke）は、参照している sink を即 `status='error'` にして通知する（20連続失敗を待たない）。

### 1-2. `sink_deliveries` — 配達ログ兼アウトボックス

```sql
create table sink_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  sink_id uuid not null references integration_sinks(id) on delete cascade,
  digest_task_id uuid,                -- タスク単位の履歴・external_refs 突合用（ping は NULL）
  event_type text not null,           -- 'task.created' | 'task.done' | 'task.dismissed' | 'task.reopened' | 'ping'
  event_key text not null,            -- 冪等キー: 状態遷移1回ごとに一意（§2-1）
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'dead')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,                    -- 先頭数百byteに切り詰めて保存（レスポンスbodyは保存しない）
  response_status int,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (sink_id, event_key)
);

-- dispatcher 用の部分インデックス
create index sink_deliveries_dispatch_idx
  on sink_deliveries (next_attempt_at) where status in ('queued', 'failed');
```

- **event_key の意味論（重要）**: `<event_type>:<task_id>` では **done→reopen→再done で2回目の done が unique 衝突して無音消滅**する。event_key は**状態遷移1回ごとに一意**にする — 実装はトリガー内で生成する **遷移イベントUUID**（`gen_random_uuid()`）を全 sink 行で共有する形（`<event_type>:<task_id>:<event_uuid>` 等）。unique(sink_id, event_key) は「同一遷移の二重 enqueue 防止」として保持。
- **payload は常にフルスナップショット**（イベント時点の status を含む task 全体）＋ `occurred_at` 必須。受信側が任意イベントを upsert / last-write-wins として扱えるようにし、順序保証なし（§2-2）の実害を消す。
- `dead`: 恒久失敗 or 最大試行超過。配達ログとして残す（削除しない）。**再送手段あり**（§3 redeliver）。
- RLS: internal member SELECT のみ。書き込みは service role のみ。

### 1-3. `sink_external_refs` — 外部オブジェクト対応表（Notion 用）

```sql
create table sink_external_refs (
  sink_id uuid not null references integration_sinks(id) on delete cascade,
  digest_task_id uuid not null,
  external_ref text not null,         -- Notion page_id 等
  created_at timestamptz not null default now(),
  primary key (sink_id, digest_task_id)
);
```

- created 配達の delivery 行が dead 化・再送されても対応関係が壊れないよう、deliveries とは独立に保持する。

---

## 2. 配送機構

### 2-1. enqueue — **DBトリガー方式（確定）**

supabase-js（PostgREST 単発 update）には複文トランザクションが存在しないため、「API内トランザクションで enqueue」は選択肢として実在しない。また消し込み経路は postback／「完了N」／コンソール PATCH／世代再リンク時 auto-dismiss と複数あり、RPC 個別対応は漏れる。よって:

- **`channel_digest_tasks` への AFTER INSERT / AFTER UPDATE トリガーで `sink_deliveries` に enqueue する**。
  - INSERT → `task.created`。UPDATE は **`old.status is distinct from new.status` の時のみ**発火（done/dismissed/reopened を new.status から導出）。
  - sink 解決はトリガー内の `insert … select`: `org_id 一致 AND (group_id IS NULL OR group_id = new.group_id) AND status='active' AND event = any(events)`。
  - 遷移イベントUUIDをトリガー内で1つ生成し、対象 sink 全行の event_key に共有。
  - digest 抽出（`rpc_ingest_digest_tasks`）の ON CONFLICT DO NOTHING で挿入されなかった行はトリガーが発火しない＝dedupe と自然に整合。抽出 Tx がロールバックされれば enqueue も消える（受け入れ条件1を自動で満たす）。
- **付随修正**: `updateDigestTaskStatusConsole`（store.ts）は現状 status ガードがなく done→done の空遷移でも行更新される。トリガーは status 変化時のみ発火するので誤配達にはならないが、**同一 status への更新を no-op にするガードを追加**する（updated_at 等の無駄な変更も防ぐ）。

### 2-2. dispatch（配送ワーカー）

- `POST /api/cron/sink-dispatch`（CRON_SECRET Bearer、既存 cron 基盤と同型）を **pg_cron で5分間隔**起動。
- 併せて **enqueue 直後にベストエフォートの即時ディスパッチ**を1回試みる（digest直後にNotionに載っている体験のため）。失敗しても cron が拾うので結果整合。
- 選定: `next_attempt_at <= now() AND status in ('queued','failed')` を古い順、**`for update skip locked`** で多重起動に安全。1起動あたり全体上限（例: 100件）に加え **sink あたり上限（例: 10件）** — 壊れた1 sink のリトライがバッチを占有して健全な sink を飢えさせない。
- **sink が active でない間は配送対象から外す（attempts 据え置き）**。error/disabled 中に attempts を消費して、再有効化した瞬間に一斉 dead 化する事故を防ぐ。
- **再有効化時**（PATCH で error/disabled → active）: `consecutive_failures = 0`、対象 deliveries の `next_attempt_at = now()` にリセット。
- **失敗の分類**:
  - 恒久失敗（400/401/403/404/422 等）→ リトライせず即 `dead`（毒 delivery が consecutive_failures を押し上げるのも防ぐ。ただし 401/403 は認証失効の可能性があるため consecutive_failures には数える）
  - 一時失敗（408/429/5xx/timeout/ネットワーク）→ 指数バックオフ（1分→5分→30分→2時間→6時間、5回で `dead`）
- **sink の自動停止**: `consecutive_failures > 20` で `status='error'` ＋ org 内部向け通知（既存 notifications 基盤）。

### 2-3. provider 別の配達（SinkAdapter）

```
deliver(sink, delivery) -> { ok, permanent?, responseStatus?, error? }
```

**webhook（最軽量・「自社ツール連携」の実体）**
- `POST <config.url>`、ボディ:
  ```json
  {
    "id": "<delivery id>",
    "event": "task.created",
    "event_key": "...",
    "occurred_at": "...",
    "data": { "task": { "id", "title", "assignee_hint", "status", "group", "space", "source": {"channel":"line"} } }
  }
  ```
- 署名: `X-AgentPM-Signature: t=<unix秒>,v1=<hex(hmac_sha256(secret, t + "." + body))>`（Stripe/Slack 同型。受信側は t で5分リプレイ窓を検証）。**署名フォーマットは顧客の受信実装が依存する不可逆仕様** — v1 で確定、変更時は v2 併記方式。
- **SSRF 対策（必須・実装粒度で規定）**:
  - https のみ・ポート443のみ・リダイレクトは追わない（3xx は恒久失敗）。
  - **deny 対象IP**（IPv4/IPv6 両方）: ループバック（127.0.0.0/8, ::1）／プライベート（10/8, 172.16/12, 192.168/16, fc00::/7）／リンクローカル（169.254.0.0/16, fe80::/10）／**IPv4-mapped IPv6（::ffff:0:0/96 は内包IPv4で再判定）**／0.0.0.0/8／100.64.0.0/10（CGNAT）／192.0.0.0/24／マルチキャスト・予約域／クラウドメタデータ（169.254.169.254, fd00:ec2::254）。
  - **DNS ピン留め**: 名前解決→全レコードを deny 判定→検証済みIPのみで接続。Node fetch の URL 差し替えは TLS SNI/証明書検証が壊れるため、**undici Agent の custom lookup** で実装する（rebinding 対策として「登録時 public → 配送時 private」も防がれる）。
  - deny 判定は**共有ライブラリ1箇所**に集約し、登録時（POST/PATCH）・test 配達・本配送の**3経路すべてが同じ関数を通る**。
  - レスポンス body は保存しない（last_error へは先頭数百 byte に切り詰め）。タイムアウト10秒。

**Notion**
- OAuth（public integration）で接続 → `connection_id` 参照。宛先は config.database_id。
- **ref ベースの upsert 意味論**（順序非依存）:
  - 任意のイベント配達時、`sink_external_refs` に ref があれば**そのページを更新**、なければ**イベント時点のスナップショットでページ作成＋ref 登録**。
  - つまり done が created より先に着いても「done 状態でページ作成」になり、後着の created は ref 存在により更新で吸収される（二重ページを作らない）。
- レート制限 3req/秒: dispatch ループで provider 別に間隔制御。

**Google Sheets**
- 既存 Google OAuth 基盤（integration_connections + token-manager）にスコープ `spreadsheets` を追加した接続を利用。
- 全イベントを**行 append**（ログ方式・行更新はしない）。at-least-once による重複行があり得ることを受信側向けドキュメントに明記（**ログであり台帳ではない**）。

### 2-4. ペイロード最小化と redaction 連動

- 配達するのは **digest タスクのタイトル・状態・担当ヒント・出典（グループ名/space名）まで**。元のチャット本文・添付・identity 実名は配達しない。タイトルに人名等が入り得ることはドキュメントに明記。
- **redaction 連動（実体を定義）**: `rpc_redact_channel_message` を拡張し、`source_message_id` が一致する `channel_digest_tasks` の **title を破壊（`[削除済み]`）した上で dismissed 化**する。この status 遷移がトリガー経由で `task.dismissed`（破壊済みタイトルのスナップショット）として配達され、**外部の残骸を上書きする**。
- 配達済み `sink_deliveries.payload` は内部証跡として残す（ペイロード最小化により被害は限定される）。外部サービス側に配達済みの旧タイトルが残る可能性は仕様限界としてドキュメント明記。

---

## 3. API

| Method | Path | 権限 | 内容 |
|--------|------|------|------|
| GET | `/api/integrations/sinks` | internal | org の sink 一覧＋直近配達状況 |
| POST | `/api/integrations/sinks` | owner/admin | 作成。webhook は secret を生成して**一度だけ平文返却**（以後は取得不可） |
| PATCH | `/api/integrations/sinks/[id]` | owner/admin | 有効/無効・イベント購読・宛先変更・secret ローテーション（新 secret 一度だけ返却）。再有効化時は §2-2 のリセット |
| DELETE | `/api/integrations/sinks/[id]` | owner/admin | 削除（deliveries はログとして残す） |
| POST | `/api/integrations/sinks/[id]/test` | owner/admin | テスト配達（`event: "ping"`、SSRF 検証も本配送と同一関数） |
| POST | `/api/integrations/deliveries/[id]/redeliver` | owner/admin | dead/failed → queued へリセット（同一行なので unique 制約と整合） |
| POST | `/api/integrations/sinks/[id]/redeliver` | owner/admin | sink 単位の一括再送（dead/failed 全件） |
| GET | `/api/integrations/deliveries?sinkId=&taskId=` | internal | 配達ログ（ページング。taskId 絞り込みは digest_task_id 列で） |
| POST | `/api/cron/sink-dispatch` | CRON_SECRET | 配送ワーカー |

- リソースの org 解決はサーバ側（Stage 2 PR A と同じ resource-org authorization パターン）。
- Notion / Google の OAuth 開始・callback は既存 integration_connections のフローに provider 追加。

---

## 4. UI（設定画面）

- 置き場所: 秘書コンソール内にタブ追加（`/{orgId}/secretary` → 「連携」タブ）。3ペイン規則に従い、Main ペイン内2カラム（左=sink一覧、右=選択中 sink の設定＋配達ログ）。モーダル禁止・保存ボタンなし（optimistic updates）。
- webhook secret は作成/ローテーション直後のみ表示（コピー導線付き）。
- 配達ログ: 直近N件の status / 宛先 / event / エラー。dead には再送ボタン。`error` 状態の sink はバナーで再有効化導線。

---

## 5. LP・営業上の見せ方

- 「秘書が拾う。届け先はあなたの今の道具のまま。」— Notion・スプレッドシート・自社ツール（Webhook）に対応、と業種LPの共通セクションに追加。
- 技術層向けには汎用 Webhook＋（将来）MCP 対応を「自社システムに組み込める」として訴求（MCP は既存 `MCP_TOOL_GOVERNANCE` 基盤の露出であり本設計のスコープ外）。
- webhook 受信側向け公開ドキュメントに明記: **順序保証なし・at-least-once・event_key で dedupe・occurred_at で last-write-wins**・ペイロードはフルスナップショット。

---

## 6. 請求・見積（柱B: 設計方針のみ・実装は需要確認後）

### 位置づけ

「お金の回収」。価値の中心は発行ではなく**発行後のループ**（送付→開封→承認→入金確認→督促→消込）で、これは資料回収エンジンと同型。

### 第1形態（外部連携）

- 対象候補: freee請求書 / マネーフォワード クラウド請求書 / Misoca（いずれも API あり。着手時に最新仕様確認）。
- フロー案:
  1. 見積: 既存 `estimate_status`（none/pending/approved/rejected）の承認フローを流用。承認はアクショントークンページ。
  2. 承認済み見積 → **外部サービスに請求書ドラフトを起票**（sink と同じ配達思想。適格請求書の記載要件・登録番号・控え保存は外部サービスが負う）。
  3. 発行済み請求書の**送付リンクをチャネルで秘書名義送付** → 開封（リンク tap）を証跡記録。
  4. 入金確認: 外部サービスの入金ステータスの**読み取りポーリング→内部通知→人が消し込みを確定**。§0 の書込方向原則のとおり、読み取り＋人の確定は原則に抵触しない（**自動消し込みのみが違反**）。
  5. 未入金の督促: 既存リマインド基盤（pg_cron+テンプレート）を金銭向けの文面で。
- **自社発行（柱C）は deferred**: インボイス制度の記載要件・登録番号・端数処理・電帳法の発行控えを自前で負うことになるため、外部連携で需要を確認してから。

### この章の実装条件

- ヒアリング/実利用で「請求・督促」の需要シグナルが取れたら、本章を独立設計書（`AI_SECRETARY_BILLING_DESIGN.md`）に昇格して詳細化する。Stage 3 実装には含めない。

---

## 7. 確定済み論点（v0.1 の未決 → fable-architect 裁定で確定）

1. **Notion の外部参照**: 専用表 `sink_external_refs`（§1-3）＋ adapter は ref ベースの upsert 意味論（§2-3）。done 先着でも自己完結し順序補完も同時解決。
2. **dismissed は配達する**: 世代 relink 時の auto-dismiss と redaction 連動 dismiss で外部の残骸を消す手段がこれしかない（外部台帳の整合 > ノイズ削減）。デフォルト購読に含め、ノイズを嫌う顧客は events 購読から外せる。
3. **入金読み取りと一方向原則**: 原則を「書込方向の原則」として再定義（§0-1）。読み取り→内部通知→人が確定は適合、自動消し込みのみ違反。
4. **配達順序は保証しない**: 緩和はプロトコルで行う — フルスナップショット＋occurred_at（受信側 LWW）＋ Notion upsert 意味論。受信側ガイドに明記。

---

## 8. やらないこと（deferred）

- 自社での請求書・見積書PDF発行（§6 のとおり外部連携で需要確認後）
- 双方向同期（Notion/Sheets 側の変更取り込み）
- Zapier/Make 公式アプリ化（汎用 Webhook で代替可能。需要が出たら）
- 配達先ごとのフィールドマッピング UI（v1 は固定スキーマ）

---

## 9. PR 分割案

| PR | 内容 | 依存 |
|----|------|------|
| PR-1 | migration（integration_sinks / sink_deliveries / sink_external_refs / enqueue トリガー / connections provider 追加 / redaction RPC 拡張）＋ dispatch cron ＋ **webhook adapter**（SSRF 共有ライブラリ込み）＋ test 配達 ＋ redeliver | なし |
| PR-2 | 連携タブ UI（sink CRUD・配達ログ・再送・secret 一度だけ表示） | PR-1 |
| PR-3 | Notion adapter（OAuth 接続追加＋external_refs upsert） | PR-1 |
| PR-4 | Google Sheets adapter（スコープ追加＋append） | PR-1 |

## 10. 受け入れ条件

1. digest 抽出と同一 Tx で deliveries が enqueue され、抽出がロールバックされたら enqueue も消える
2. **done→reopen→done の3遷移がすべて配達される**（event_key 意味論の回帰テスト）
3. **postback・「完了N」・コンソール・relink auto-dismiss の全経路で enqueue される**（トリガー網羅性）
4. **redaction 実行で digest タスク title が破壊され、task.dismissed が配達される**
5. webhook 署名が Stripe 同型（t + v1）で検証可能・リプレイ窓5分
6. SSRF: private IP / http / リダイレクト / **::ffff:169.254.169.254 / IPv6 ULA / DNS rebinding（登録時 public→配送時 private）** が登録・test・本配送の全経路で拒否される
7. 恒久失敗（400/404/422）は即 dead、一時失敗のみ指数バックオフで5回→dead、20連続失敗で sink=error＋通知
8. **dead の redeliver で再配達される。sink 無効/error 中は attempts が増えない。再有効化でカウンタとスケジュールがリセットされる**
9. 同一遷移の二重 enqueue が unique(sink_id, event_key) で防がれる
10. secret_encrypted が authenticated から select できない／別 org の sink・deliveries が RLS で見えない
11. sink 削除後も配達ログが参照できる
12. グループ再リンク（新世代）時に旧世代向け sink が disabled になり通知される
13. **done が created より先に届いた場合に Notion 側が二重ページにならない**（upsert 意味論）
