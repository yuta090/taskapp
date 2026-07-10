# AI秘書 Stage 2 設計書 — 秘書コンソール／グループLINE×日次タスク抽出

> **Status**: 設計確定（fable-architect 敵対レビュー反映済み・実装前）
> **Last Updated**: 2026-07-11
> **前提**: Stage 1 配管（`CHANNEL_PLUMBING_SPEC.md`）実装・本番適用済み
> **設計正本（骨格）**: `AI_SECRETARY_DESIGN_v0.1.md`

## 0. Stage 2 のスコープ（3本柱）

| # | 機能 | 動機 |
|---|------|------|
| 2a | **秘書コンソール**（agentpm Web UI） | PCで作業する人が、サイトから秘書に仕事を振る・確認依頼を送る・会話を遡る。bot有効/無効の管理 |
| 2b | **グループLINE取り込み＋日次タスク抽出** | 飲食・接客業のスタッフグループの申し送りが「流れて忘れられる」のをフォロー。毎朝、未完了だけを一覧表示。消し込みはチャット内で完結 |
| 2c | **友だち追加特典（個人向け機能）** | グループは匿名で成立させつつ、友だち追加した人だけが得をする機能で登録数を増やす |

戦略整合: 汎用チャットボット化ではなく「**流れて消えるものを拾う → 一覧化 → 催促 → 消し込みの証跡**」＝回収・催促・証跡エンジンの同族として位置づける（新業種の芽:「申し送りさえ、残れば。」）。

## 1. アカウント所有構造（2026-07-11 確定）

- **LINE公式アカウントの持ち主は各企業（事務所・店舗）**。各社が自分のビジネスIDで作成（未認証・審査なし・無料）し、当社は運用権限＋Messaging API資格情報を受領して `channel_accounts` に登録する。利用規約が第三者への運用委託を明示的に許容。
- 当社名義での量産はしない: 認証審査はアカウント名に運用主体の正式名称が必要／公式ドキュメントが「サービス提供企業のプロバイダー配下にクライアント企業のチャネルを作る」構造に注意喚起／プロバイダーは**後から変更不可**。
- プロバイダーごとに userId が異なるが、identity は org 単位で管理しており org 横断の userId 同一性に依存しないため整合。
- アカウント作成〜接続は「入社手続き」体験に組み込む（同席/画面共有での登録代行）。
- **bot の有効/無効（disabled）の意味**: `channel_accounts.status='disabled'` は「**受信の記録は続け、能動的な動作だけ止める**」状態。
  - inbound は通常どおり記録する（挨拶で「記録に残ります」と約束した以上、無音破棄は証跡エンジンの自己否定。disabled 中に届いた資料・連絡が消えると紛争リスク）
  - 止まるもの: 自動応答（挨拶・突合確認）・digest 配信・送信API（409）
  - 「記録もしない」は**解約**の話であり別状態。解約フロー（LINE側webhook停止＋データ処分）は §9 未解決へ

## 2. スキーマ差分（migration 1本）

### 2.1 `channel_groups` — グループトークの台帳（世代方式）

```sql
create table channel_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete restrict,
  space_id uuid,                -- 紐付け先（店舗/顧問先）。参加直後は null、リンクコードで確定
  account_id uuid not null references channel_accounts(id) on delete restrict,
  channel text not null default 'line' check (channel in ('line','chatwork','slack','google_chat')),
  external_group_id text not null,   -- LINE groupId（bot退出→再招待でも同一）
  display_name text,
  status text not null default 'active' check (status in ('active','left')),
  digest_enabled boolean not null default true,
  -- 抽出水位: このグループで最後にLLM抽出へ投入した channel_messages.created_at
  last_extracted_message_created_at timestamptz,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (space_id, org_id) references spaces(id, org_id) on delete restrict
);

-- 世代方式: active な行は1グループ1件。left後の再参加・付け替えは新規行（新世代）
create unique index channel_groups_active_unique
  on channel_groups(account_id, external_group_id) where status = 'active';
-- 子テーブルの複合FK用（org境界の保護。Stage 1 の spaces(id, org_id) と同型）
create unique index channel_groups_id_org_unique on channel_groups(id, org_id);
```

- **space_id は NULL→値の一方向のみ**（トリガーで強制）。**誤紐付けの是正は「unlink（status='left'）→ 再リンク（新世代行）」**で行う — bot を物理的に退出させる必要はない。旧世代の group_id/space_id は過去メッセージ・digestタスクに残る（証跡として正しい）。
- **旧世代の open な digest タスクは新世代へ引き継がず auto-dismiss**（unlink 処理内で status='dismissed'）。
- 再招待（LINEのjoin）で active 行が既にあればそれを使い、無ければ新世代を作る。

### 2.2 `channel_messages` への列追加

```sql
alter table channel_messages add column group_id uuid;
alter table channel_messages add constraint channel_messages_group_fk
  foreign key (group_id, org_id) references channel_groups(id, org_id) on delete restrict;
create index channel_messages_group_timeline on channel_messages(group_id, created_at desc);
```

- group_id は**不変列**（guard トリガーの immutable リストに追加）。複合FKにより「メッセージのorg ≠ グループのorg」をDBが拒否（RLS境界の保護）。
- グループ発言は `external_user_id` が取れない（匿名メンバー）ことがある → 既に nullable、許容。

### 2.3 `channel_digest_tasks` — 申し送りタスク

```sql
create table channel_digest_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  group_id uuid not null,
  space_id uuid,                     -- グループ紐付けからのデノーマライズ
  source_message_id uuid not null references channel_messages(id) on delete restrict,
  title text not null,               -- LLM抽出（例:「金曜までに酒屋へ発注」）
  assignee_hint text,                -- LLMが読み取った担当者名（自由文字列）
  assignee_identity_id uuid references channel_identities(id),  -- 友だち紐付け済みなら
  status text not null default 'open' check (status in ('open','done','dismissed')),
  digest_number int,                 -- 最新digestでの表示番号（「完了N」返信の突合用）
  done_at timestamptz,
  done_by_external_user_id text,     -- 誰が消し込んだか（匿名なら null）
  done_via text check (done_via in ('postback','reply','console')),
  extracted_date date not null,      -- 抽出日（JST。formatDateToLocalString 使用・toISOString禁止）
  created_at timestamptz not null default now(),
  unique (source_message_id, title),  -- 再抽出dedupeの二次防衛（一次は抽出水位 §4）
  foreign key (group_id, org_id) references channel_groups(id, org_id) on delete restrict,
  foreign key (space_id, org_id) references spaces(id, org_id) on delete restrict
);
```

- RLS: 2表とも Stage 1 と同じ（SELECT=内部メンバー `app_is_org_internal` / 書込=service roleのみ）。
- **申し送りタスクは背骨の証跡ではなく作業リスト** — append-only は持ち込まない。ステータス遷移は open→done/dismissed に加え、**done→open の復旧（コンソールのみ。done_at/done_by/done_via をクリア）**を許容する。消し込み操作の原本証跡は channel_messages（postback/返信の記録）側に残る。
- tasks（本体タスク）とは**別テーブル**: 申し送りは玉石混交・大量・短命・匿名操作ありで、ball/review 等の本体ワークフローと構造が異なる。将来「正式タスクに昇格」ボタンで tasks へ**一方向コピー**のみ想定。

## 3. webhook 拡張（LINE）

| イベント | 処理 |
|---------|------|
| `join`（グループ招待） | channel_groups の active 世代を upsert ＋挨拶push（**AI名乗り＋「やり取りは記録に残ります」**＋リンクコード案内） |
| `leave` | 当該世代を status='left', left_at 記録 |
| **`room`（複数人トーク）** | **Stage 2 では非サポート**。join 時に「グループトークでご利用ください」と送って退出（roomの退出はグループとは別エンドポイント `/room/{roomId}/leave` である点に注意）。記録は system イベントのみ |
| グループの `message` | group_id 付きで記録。リンクコード形状のテキストは「**グループ⇔space の紐付け**」として処理（下記）。それ以外は記録のみ |
| `postback`（`action=digest_done&task=<uuid>`） | 消し込み（下記の検証と原子更新） |
| 「完了N」「N 完了」テキスト（グループ内） | 最新digest世代の digest_number=N を消し込み。マッチしなければ通常メッセージとして記録のみ |

### グループメッセージの帰属（不変条件）

- **グループメッセージの space_id は「グループの space_id」のみに由来する。identity ベースの自動帰属は絶対に適用しない**（1対1用の「active identity 1件なら space 確定」ロジックをグループに流用すると、店舗Bのグループ発言に顧問先Aの space_id が焼き付き、NULL→値一方向のため修復不能になる）。identity_id の記録自体は可（誰の発言かの参考情報）。
- **バックフィルの責務**: リンクコード成立ハンドラが**同一処理内で**、当該 group_id かつ space_id IS NULL の channel_messages と open な channel_digest_tasks に space_id を backfill する（「紐付け時にバックフィル可」ではなく必須処理）。

### 消し込みの検証・冪等性

- postback 検証: ①task.group_id が webhook を受けたグループの active/直近世代であること ②**task→group→account→org の系列が webhook で解決した account と一致**すること（org 境界の二重検証）。
- **原子更新**: `update channel_digest_tasks set status='done', ... where id = ? and status = 'open'`。0行なら「既に完了済みです」と reply（postback 二重タップ・同時返信の両方を吸収。リプレイ攻撃も webhookEventId dedupe＋この原子更新で無害化）。
- 消し込み確認は **replyToken でタイトルを引用返信**（「『酒屋へ発注』を完了にしました」）— 誤消し込みの可視化＋reply は通数無料。
- disabled アカウント: inbound は記録するが、紐付け確認・消し込み確認等の自動応答は停止（§1）。
- グループでは自動応答を最小化する（挨拶・紐付け確認・消し込み確認・digest 以外は発言しない）。雑談・相談への反応は行わない（税理士法52条ガードレールはグループでも同一）。

## 4. 日次digest（pg_cron）

```
cron.schedule('channel-digest', '0 22 * * *')  -- 22:00 UTC = 翌朝 7:00 JST
  → app_invoke_channel_digest()（Vault: cron_secret / cron_channel_digest_url）
  → POST /api/cron/channel-digest（Bearer CRON_SECRET・client-reminders と同一パターン）
```

処理（org → group ごと）:

1. 対象: `channel_groups.status='active' and digest_enabled`（account が active であること）
2. **抽出（exactly-once 三段防衛）**: `last_extracted_message_created_at` より後の group メッセージ（text のみ・secretary/system 発言除く）を `callLlm(orgId)` に渡してタスク候補を抽出（title / assignee_hint / source_index）。
   - **一次防衛: 抽出水位** — タスクINSERTと**同一トランザクションで**水位を更新し、同じメッセージを二度LLMに投入しない
   - 二次防衛: `unique(source_message_id, title)`（完全同一titleのみ捕捉するバックストップ）
   - 三次防衛: 人間の dismiss（誤抽出・重複はコンソール/チャットから消せる）
3. **配信**: まず**当該グループの digest_number を全行 NULL クリア**してから、open なタスクに 1..N を振り直す（「完了N」が常に最新世代のみにマッチし、昨日の一覧を見た返信が今朝の別タスクを消さない）。グループへ push:
   - テキスト部「おはようございます。今日の申し送りです（N件）」＋番号付き一覧
   - Flex Message のボタン（postback）を上位10件まで。超過分は「ほか◯件はコンソールで」
   - **openが0件なら送信しない**（通数と通知疲れの節約）
4. done/dismissed は翌朝から出ない（消し込みの反映）

制約・安全:

- **LLM抽出は org_ai_config が登録済みの org のみ**（`callLlm` の既存仕様）。未設定 org はスキップしてログに残す。
- **prompt injection 対策**: グループ発言は非信頼入力。digest 本文は**サーバ側テンプレート合成のみ**とし、LLM出力からは title 文字列（長さ上限・改行/制御文字除去）だけを埋め込む。**LLM に push 全文を書かせない**。
- 日付処理は JST（`formatDateToLocalString`。`toISOString()` による日付ずれ禁止はサーバ側にも適用）。
- WoZ整合: 抽出はLLM（頭脳の一部先行）だが、誤抽出は dismiss で消せるため許容。依頼・催促の**文面生成は引き続き人力**（コンソール送信）。

### 通数の設計（重要）

LINE無料枠（月200通/アカウント）を消費するのは **push のみ。reply は無料**。

| 通信 | API | 通数 |
|------|-----|------|
| 朝digest | push | グループ数 × 約30/月 |
| 消し込み確認・紐付け確認 | **reply（必須）** | 0 |
| 2c 個人DM | push | **設計上の主リスク**（友だち5人×日次=150/月で枠をほぼ消費） |

→ **2c の個人DMはデフォルト週次 or opt-in**とし、日次はプラン超過（従量課金は店舗側負担）の説明とセットでのみ有効化。オンボーディング資料に費用負担の明記を含める。従量監視（§9）は **PR C の前提条件に格上げ**。

## 5. 秘書コンソール（agentpm UI）

### 配置・レイアウト

- ルート: `/{orgId}/secretary`（`(internal)` 配下・AppShell/LeftNavに「秘書」を追加）
- Main ペイン内 2 カラム（UI RULES準拠: 3ペイン骨格は維持、Inspector は使わない）:
  - **左: 接続リスト** — space（顧問先/店舗）と グループ の連携状態。identity数・グループ紐付け・突合コード発行ボタン（コード＋期限表示・コピー）・グループの digest ON/OFF・unlink→再リンク
  - **右: タイムライン＋送信** — 選択した space/グループの channel_messages（inbound左・outbound右の吹き出し、actor/時刻、添付はアイコン＋ファイル名、redacted は墓標表示）。下部に送信ボックス
- ヘッダ: bot アカウント状態（display_name、**有効/無効トグル**=owner/adminのみ、未登録なら登録手順への案内）
- **誤爆ガード**: コンポーザーに**送信先バッジ（1対1: 相手名＋space名 ／ グループ: グループ名＋紐付けspace名）を常時表示**。グループ宛ては送信ボタンを**インライン2段階**（「◯◯グループへ送信 → 確認して送信」。モーダルは使わない）
- **Amber-500**: 送信ボックス周り（顧問先・スタッフに見える発言であることの明示）。**保存ボタンなし・optimistic update**（送信は即時吹き出し追加→失敗時にエラー表示）

### データ取得と API

| 用途 | 経路 |
|------|------|
| タイムライン・identity・グループ・digestタスク閲覧 | クライアントから Supabase 直（RLS SELECT=内部メンバー、実装済み） |
| 送信（1対1） | `POST /api/channels/messages`（実装済み） |
| 送信（グループ宛て） | 同APIの拡張: `groupId` 指定。**サーバ側で groupId が orgId 配下かつ status='active' かつ account が active であることを検証** |
| 突合コード発行 | `POST /api/channels/link-codes`（実装済み） |
| bot状態取得 | **新規** `GET /api/channels/accounts?orgId=` — 秘密列を除く（id, channel, display_name, line_bot_user_id, status）。内部メンバー |
| bot有効/無効 | **新規** `PATCH /api/channels/accounts` — {accountId, status}。**owner/adminのみ。accountId の org とユーザの org 一致をサーバ側で検証** |
| グループ管理 | **新規** `PATCH /api/channels/groups` — {groupId, digestEnabled? / displayName? / unlink?}。内部メンバー。**groupId の org 一致をサーバ側で検証**。unlink は status='left' 化＋open タスクの auto-dismiss |
| digestタスク消し込み/復旧 | **新規** `PATCH /api/channels/digest-tasks` — {taskId, status: done/dismissed/open}。内部メンバー。**taskId の org 一致をサーバ側で検証**。done_via='console' |

- 全 PATCH/POST は「authenticated であること」ではなく「**対象リソースの org に対する内部メンバーであること**」をサーバ側で検証する（RLSはSELECTのみのため、書込系の認可はAPI層が唯一の防壁）。
- channel_accounts は authenticated から読めない設計（資格情報保護）のため、メタ情報のみAPIで返す。トークン・secret は**いかなるAPIでも返さない**。
- 「秘書に仕事を振る・確認依頼」はコンソールの送信ボックス＝秘書名義送信で実現。定型文テンプレ（回収依頼・確認依頼・リマインド）をコンポーザーに用意し、WoZ の手数を減らす。

## 6. 友だち追加特典（2c・二層設計）

**技術的根拠: bot は友だち追加していないユーザーに push（DM）できない** — 特典境界がLINEの仕様と一致する。

| 層 | 対象 | 機能 |
|----|------|------|
| 層1（匿名・登録不要） | グループ全員 | 朝digest閲覧、postback/返信での消し込み |
| 層2（友だち追加＋identity突合済み） | 個人 | ①自分宛て（assignee_identity_id=自分）タスクのDM通知 ②「自分の分だけ」ダイジェストDM（**デフォルト週次 or opt-in** — §4通数設計） ③持ち越しの個人リマインド ④記名消し込み（誰が完了したかの証跡） |

- assignee_hint（LLMの読んだ名前）→ identity への解決は、**コンソールでの手動割り当てを起点**にし、学習的な自動化はしない（Stage 2 では割り当てUI＋DM通知まで）。
- グループ内の digest に「友だち追加すると自分宛てだけ通知が届きます」の一行を**月1回程度**添えて導線にする（毎回は出さない・通知疲れ防止）。

## 7. 実装順序と分割（1 worktree = 1 PR）

| PR | 内容 | 依存 |
|----|------|------|
| **PR A** `feat/secretary-console-*` | コンソールUI＋accounts GET/PATCH＋disabled時の送信409 | なし（Stage 1のみ） |
| **PR B** `feat/channel-groups-digest-*` | migration（§2）＋webhook拡張（§3）＋cron digest（§4）＋messages APIのgroupId対応＋groups/digest-tasks PATCH | なし（Aと並行可） |
| **PR C** `feat/friend-perks-*` | 割り当てUI＋自分宛てDM通知（§6） | A・B・**従量監視（§9）** |

- いずれも TDD（Red→Green→Refactor）・develop 宛て。migration は timestamp 命名・ドライラン→適用→applied_migrations 記録。
- pg_cron 登録と Vault secret（`cron_channel_digest_url`）追加は PR B 適用時の手作業（client-reminders と同一手順）。

## 8. 検証項目（受け入れ条件）

1. disabled アカウント: **inbound は記録され続け**、自動応答・digest・送信API（409）だけ止まる。トグルで復帰
2. グループ join → 挨拶（記録明示文言）→ リンクコードで space 紐付け → 以降の発言に space_id が付く。**紐付け時に過去メッセージ・open タスクへ backfill される**
3. **誤spaceに紐付け → unlink → 再リンクで新世代が機能し、旧世代の open タスクが auto-dismiss される**
4. **1対1 identity を持つ人のグループ発言に、identity 由来の space_id が付かない**（グループの space_id のみ）
5. 匿名メンバーの発言（userId なし）が記録され、digest 抽出対象になる
6. 朝digest: open のみ・0件なら送らない・postbackで消える・「完了2」返信で消える・翌朝出ない。**昨日の digest の「完了N」が今朝の別タスクを消さない**（番号クリアの確認）
7. **postback 二重タップの2回目が「既に完了済みです」になる**（原子更新）
8. 他グループ/他org の postback・他org 内部ユーザの groups/digest-tasks/accounts PATCH が拒否される
9. **抽出の exactly-once**: タスクINSERT成功→水位更新失敗の擬似クラッシュ→再実行で重複タスクが出ない（同一トランザクション）
10. org_ai_config 未設定 org で digest cron がエラーにならずスキップされる
11. room に招待されたら案内を送って退出する
12. コンソール: 送信が optimistic 反映・グループ宛て2段階確認・redacted 墓標表示・owner/admin 以外にトグル非表示
13. tasks（本体）に影響なし（既存テスト全緑）

## 9. 未解決（意図的に先送り）

- **解約フロー**（LINE側webhook停止＋データ処分。disabled とは別状態）
- **LINE通数の従量監視・アラート**（PR C の前提条件）
- 申し送り→本体 tasks への昇格動線（運用後に判断）
- メール・Chatwork 等の他チャネルへの digest 展開
- assignee 自動解決（表示名→identity の学習）
