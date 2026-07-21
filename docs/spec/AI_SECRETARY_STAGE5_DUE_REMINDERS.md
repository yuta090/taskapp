# AI秘書 Stage 5 設計 — 期限リマインド＋完了確認ループ

> Status: DRAFT v2（実装前レビュー用・Codex REJECT＋事実確認＋Fable再裁定を反映）/ 起案 2026-07-21
> レビュー経緯: Fable初裁定 → Codex(Plan Reviewer) REJECT → Opusが実コードで事実確認 → Fable再裁定（3クラックス）→ 本改訂。§14 参照。
> 関連: [[AI_SECRETARY_STAGE2_6_DUE_ASSIGNEE]], [[AI_SECRETARY_STAGE2_7_APPROVAL]], [[AI_SECRETARY_STAGE3_INTEGRATIONS]],
> [[MULTICA_CONNECTOR_CONTRACT]], [[CLIENT_REMINDER_SPEC]]（相手先向け催促＝別領分・v2）

## 1. 目的 / 非目的

**目的**: タスクに**期限**があれば秘書が担当者に**リマインド**を送り、**完了確認**（「完了しましたか？」）まで行う。外部タスクツール連携を「ミラーするだけ」から「拾い漏れゼロの催促・確認」へ引き上げる。Pro（マルチチャネル×マルチツール連携ハブ）の付加価値の核。訴求は時短でなく**クオリティ（拾い漏れゼロ）**。

**非目的（v1でやらない）**: 延期による**外部期限の書き戻し**（v1の延期＝リマインドのスヌーズ）／**ball 遷移**（完了は既存の完了経路に乗せるのみ・reopenもv2）／**相手先(client)への催促**（既存 `client-reminders` cron 領分・v2）。

## 2. 正本ルール（ハード制約・動かさない）

危険の本質＝「正本のねじれ→古い期限で誤リマインド＝拾い漏れゼロを謳うサービスが逆に事故」を構造的に消す。

1. **外部ツールに紐づくタスク（`connector_task_links.origin='external'`）は、常にその外部ツールが期限の正本**。TaskAppは期限を管理せず読み取ってリマインドを乗せるだけ・**外部起点タスクへ期限を書き戻さない**。
2. **TaskApp発（外部に紐づかない）タスクだけ TaskApp が期限正本**。
3. **同期ラグ中は誤リマインドを避ける**（古い/不確かな期限では送らない＝fail-quiet）。

### 2.1 「読み取り専用の期限」と「TaskApp所有のリマインド設定」を分離

- **期限（due_date）**: external権威タスクでは TaskApp 上で**読み取り専用**（強制は §5・DB層トリガー）。UIは「期限は Google Tasks で管理」と明示。編集は元ツール、poll import が唯一の書き手。
- **リマインド設定**: リマインド層はハブの付加価値なので**期限の正本が外部でも TaskApp が所有**。送る/送らない・タイミング・宛先・チャネル・スヌーズは external権威タスクでも TaskApp で設定できる（§8）。
- ⚠ **不可逆に近い製品契約**: 「external権威タスクの期限は TaskApp で編集不可」は緩める方向にしか動かせない（緩めるのは無風・締めるのは炎上）。安全側で確定。将来「TaskAppからも外部期限を編集」に転じる場合は last-writer-wins 競合設計が要り、強制層を単純に外さない → 再 Fable 裁定。

## 3. スコープ / 段階

- **v1a**（一方向リマインド）: 期限接近/超過で担当者へ通知。external権威タスクは読取りのみ・書き戻しなし。
- **v1b**（完了確認）: Flex に [完了した][まだ][○日後に再通知]。完了→§7の明示伝搬。まだ/再通知→スヌーズのみ。
- **v2**: 延期＝期限変更、ball遷移/reopen、相手先(client)向け催促、抑止の可視化UI。

**重要な単純化（実コード事実）**: **multica 起票タスクは `due_date` を持たない**（`rpc_connector_create_task` が due を挿入しない・契約上 due イベントも無い）。よって v1 の期限リマインド対象は**実質 gtasks-origin と TaskApp発**のみ。multica は capability で構造的に対象外（§6）。

## 4. データモデル（migration）

ファイル名は `date +%Y%m%d%H%M%S` 秒精度（連番禁止）。RLSは有効・policyなし＝service role専用（該当テーブル）。

### 4.1 正本権威（§5）
- `tasks.due_authority_connection_id uuid NULL REFERENCES integration_connections(id) ON DELETE SET NULL`。**NULL＝TaskApp正本**。値＝そのタスク行を作成した import 接続に**固定**（自動再割当てしない）。`ON DELETE SET NULL` で接続削除＝TaskApp正本へ縮退。
- BEFORE UPDATE トリガー `trg_guard_external_due`（§5）。

### 4.2 リマインド occurrence（§6・claim/lease/send/finalize）
- `task_due_reminder_occurrences`:
  - `id uuid pk` / `task_id uuid` / `kind text('due_soon'|'due_today'|'overdue_confirm')`（テンプレラベル）/ **`offset_minutes int`**（負=前・0=当日・正=超過。**occurrence identity の一部**）/ `due_snapshot date` / `scheduled_at timestamptz` / `status text('pending'|'leased'|'sent'|'suppressed'|'canceled')` / `leased_until timestamptz` / `attempt int default 0` / `send_count int default 0`（スヌーズ通番）/ `sent_at timestamptz` / `suppress_reason text` / `created_at/updated_at`。
  - **`unique(task_id, due_snapshot, offset_minutes)`** — 複数オフセット（1日前＋当日＋超過）を1タスク1期限で共存。due が動けば新 snapshot で新 occurrence（旧は §6 で `suppressed` 終端）。
- claim/finalize RPC（`for update skip locked`＋lease、`rpc_claim_connector_jobs` と同作法）。

### 4.3 鮮度（§6）
- `integration_connections.last_import_success_at timestamptz`。**import が全ページ取得成功後にのみ更新**（関数コメントに明記＝この不変条件が鮮度証明の前提）。

### 4.4 完了伝搬（§7）
- SQLヘルパ `_enqueue_connector_job(p_connection, p_task, p_op, p_payload)`（`_enqueue_task_mirror_job` のクローン・`connector_jobs` 対象・fold/version・内部専用grant）。PR-0 に前倒し可。
- `rpc_confirm_task_done_via_line(p_channel_account_id, p_external_user_id, p_task_id)`（SECURITY DEFINER・service_role専用grant・§7）。**旧 `rpc_confirm_task_done(p_task_id, p_actor)` は不採用**。

### 4.5 registry capabilities（PR-0へ前倒し）
- `src/lib/integrations/registry.ts` の connector 定義に `capabilities: { dueImport: boolean; completionWrite: boolean; dueFreshness: 'poll-sla' | 'webhook-observed' | 'none'; pollFreshnessSlaMinutes?: number }`。
  - gtasks = `{ dueImport:true, completionWrite:true, dueFreshness:'poll-sla', pollFreshnessSlaMinutes:<poll間隔×2> }`
  - multica = `{ dueImport:false, completionWrite:true, dueFreshness:'none' }`
  - planned 4種 = すべて false / `'none'`。

## 5. 正本境界の実装線（クラックスA）

**直書き(RLS)環境のため、読み取り専用は DB層トリガーで強制する**（クライアントは `supabase.from('tasks').update(...)` を直接叩く＝`useTasks.ts:519`。返す 409 を持つサーバ mutation 境界は存在しない）。

1. **書き戻し抑止（既に構造的に成立・新規コードなし）**: gtasks コネクタ正本への due 書き戻し経路は**そもそも存在しない**。コネクタの送信ワーカー `src/lib/connectors/dispatch.ts` `processGoogleTasksJob` は **`op!=='complete'` を no-op**（「gtasks は取り込み専用(import.ts)。TaskApp からの upsert/cancel を gtasks へ押し戻さない契約」）＝ due を含む upsert を外部へ書かない。よって制約1は本トリガー（§5-2）とこの既存設計で満たされ、**新規の書き戻し抑止コードは不要**。
   - ⚠ 誤認訂正: 初版spec/Fable/Codec が名指しした `src/lib/google-tasks/mirror.ts` は**個人ミラー**（`user_task_mirror_jobs`＝TaskApp→ユーザー個人の別 Google Tasks リスト）であり、コネクタ正本の書き戻しではない。external権威タスクを個人ミラーが個人リストへ反映するのは正本の上書きではない（別宛先）ので、**mirror.ts は変更しない**（`due:undefined` にすると個人ミラーの期限表示が壊れる）。
2. **編集拒否（DB層・トリガー）**: `app_guard_external_due()`＝`auth.role()='service_role'` なら NEW を返す／それ以外は `raise exception 'due_managed_externally'`。トリガーは **`before update on tasks for each row when (old.due_date is distinct from new.due_date and old.due_authority_connection_id is not null)`**（WHEN 節必須＝hot-path 発火絞り込み）。
   - import worker・connector RPC は service key（admin client）経由で通り、ブラウザ(authenticated)は塞がる（fail-closed）。RAISE→既存 `useTasks.ts:525` の throw→楽観更新ロールバック経路に乗る（サイレント巻き戻しは確定表示のまま乖離するので不採用）。
   - UI: `due_authority_connection_id` 非NULL で期限フィールド読み取り専用＋出所表示（TaskInspector／Gantt バードラッグも同条件で無効化）。
3. **権威の一意化＋dueImport 限定**: 権威列は「**実際に due を取り込むコネクタ（`capabilities.dueImport=true`・現状 `provider='google_tasks'`）**」だけに設定する。理由: multica 起点タスクは due を持たない（§3）ため、そこへ権威を付けると TaskApp で期限を後付けできず（読み取り専用トリガーで拒否）、リマインドも設定できなくなる。よって:
   - **gtasks 起点** → 権威＝その gtasks 接続（読み取り専用・外部が正本）。
   - **multica 起点／TaskApp発** → 権威 **NULL**（TaskApp が期限を所有＝ユーザーが期限を設定でき、TaskApp-native の鮮度で常にリマインド可能）。
   - 1タスクに external link が複数（gtasks import→multica 転送）でも、dueImport 限定により権威は自然に gtasks に決まる。backfill は `provider='google_tasks'` の external link のみ・最古＝出自。作成時は import.ts(gtasks) が権威をセットし、multica inbound（`rpc_connector_create_task`）はセットしない。
4. **⚠ service_role 素通しの棚卸し（PR-0 マージ条件）**: トリガーは service_role を通すため、server側で `tasks` の due_date を書く箇所（portal API・minutes-parser 等）が権威列を尊重するか **grep 棚卸し結果を PR 説明に添付**。将来 due_date を書く authenticated 向け RPC を足す場合、本トリガーに当たる旨をコメントで明記。

## 6. Staleness ガード（クラックスC・「不確かなら送らない」）

送信直前に task を再読取りし **3条件AND**、1つでも欠けたら**送らず `suppressed`＋`suppress_reason` 記録**（fail-quiet）:
1. `status <> 'done'`
2. 再読取りの `due_date` ＝ occurrence の `due_snapshot` と一致（不一致＝期限が動いた→旧 occurrence suppressed・planner が新 snapshot で再生成）
3. external権威なら接続 active かつ `last_import_success_at >= now() − pollFreshnessSlaMinutes`

**鮮度の根拠（Codec指摘への解決）**: cursor（updatedMin）ベースの完全 poll で、**全ページ取得成功後にのみ `last_import_success_at` を進める**なら「時刻Tまでの全変更が反映済み」が接続単位で成立し、これが全タスクの鮮度証明になる。残るのは poll 間隔ぶんの**有界遅延（≤poll間隔）**のみ。日次〜時間粒度の期限リマインドに対しこの遅延は誤リマインドの実害を生まない＝「不確かなら送らない」の実装可能な唯一の定義。
- **live 再取得（案a）不採用**: 外部API障害＝リマインド全滅・token refresh/レイテンシ/quota を毎送信に払う。
- **task単位 observed_at（案b）不採用**: poll毎に全link行 touch の書込み増幅を払って得る保証が案cと同じ。
- **multica 除外**: due_date を持たない（§3）ため証明対象が存在しない。将来 due を持つなら契約に due-change イベント＋ハートビートを足し capability を `'webhook-observed'` に昇格（再裁定不要・値変更のみ）。
- **JST**: 「今日/超過/オフセット」計算は全て JST（`toISOString()` 禁止）。
- **残リスク**: import_config 縮小で「pollに含まれないが active」な link の窓は orphan sweep が落とすまで過大主張＝v1許容・sweep SLA を検証項目に。

### 6.1 occurrence ライフサイクル
- **planner**（cron）: 設定（org/project既定＋task上書き）× due_date から occurrence を `on conflict do nothing` で materialize。
- **sender**（cron）: claim RPC（`for update skip locked`・lease 10分）→ 上記3条件 → 抑止なら `suppressed`＋reason。ただし**予算/縮退による抑止だけは `pending` に戻し `scheduled_at` を翌窓へ**（approval-notify の教訓＝抑止で永久ロストさせない。`attempt` 上限で打ち止め）→ push 成功で `sent` finalize。
- **クラッシュ窓**: push成功→finalize前クラッシュは lease 失効→再送、**決定的 retryKey = f(task_id, due_snapshot, offset_minutes, send_count)** で LINE 側 dedupe。insert後・配信前クラッシュは lease 失効で回収＝永久ロストしない。
- **スヌーズ**: [まだ]/[○日後]＝該当 overdue occurrence を `pending` に戻し `scheduled_at += N日`・`send_count += 1`。上限で `canceled`。

## 7. 完了確認ループ（クラックスB）

Flex: 「『X』の期限が過ぎています。完了しましたか？」 [完了した] [まだ] [○日後に再通知]

- **1トランザクションの RPC** `rpc_confirm_task_done_via_line(p_channel_account_id, p_external_user_id, p_task_id)` に **authz＋single-winner遷移＋監査＋connector complete enqueue** を内包（SECURITY DEFINER・service_role専用grant）。
  - **authz**: `rpc_promote_digest_task_via_line` の型を踏襲＝`channel_user_links`(revoked_at null) で口座×外部ユーザー→内部ユーザー解決＋タスクorg と link org 一致＋space アクセス確認。**client供給 `p_actor` は受けない**。
  - **single-winner＋伝搬**: `update tasks set status='done' where id=? and status<>'done' returning ...`。遷移した時だけ、そのタスクの `connector_task_links` の active 接続へ `_enqueue_connector_job(..., 'complete', {})`（**トランザクション内**＝クラッシュ窓ゼロ）。0行（`already_done`）は**友好的成功**で enqueue 分岐に入らない（二重伝搬なし）。`completionWrite:false` の接続は dispatch worker 側で no-op（registry参照）。
  - **完了ゲート**: `type='spec'` で `decision_state` 未確定、または open review 存在なら `'blocked'` を返し遷移しない（fail-closed・返信「アプリで確認してください」）。
  - 返り: `'done'|'already_done'|'forbidden'|'blocked'` ＋返信用の最小情報。
- **「ちょうど1件の外部 complete」**: `connector_jobs_pending_unique`（partial unique）＋fold/version が接続ごと pending 最新1件を保証、遷移条件付き enqueue が terminal complete を遷移1回=1回に。配達 at-least-once・complete は冪等（`rpc_connector_complete_task` は done 吸収で0行）。
- **postback authz は digest-postback＋`_via_line` 型が正典**（署名 task/action/recipient/expiry トークン機構は**発明しない**＝前回「承認トークンモジュール再利用」は撤回）。
- **個人ミラー**（`trg_enqueue_task_mirror`＝`user_task_mirror_jobs`・担当者個人の gtasks）は同 UPDATE の AFTER で従来通り発火。connector層と二重にならない・触らない。

## 8. リマインド設定UI（TaskApp所有）

- **粒度**: 組織/プロジェクトの**既定**（例: 期限1日前＋当日＋超過時）＋ **タスク単位の上書き**（TaskInspector）。設定は TaskApp データ（外部と無関係）。offset_minutes 群として occurrence planner が参照。
- **external権威タスクでも設定可能**: 期限フィールドは読み取り専用（§2.1）だが、隣で「送る/タイミング/宛先/チャネル/スヌーズ」は編集可。UIで「期限は元ツール管理・リマインドは秘書が担当」と役割を明示。
- 規約: 保存ボタンなし・楽観的更新・モーダル禁止（TaskInspector内）。amber は client 可視要素専用＝internal 向け本設定では不使用。
- Free/Pro: 設定UIは両方に見せるが、即時push・個別DM・時刻指定は Pro（§9）。Free は「日次digestに載る」旨表示。

## 9. 課金 / ルーティング（クラックスC・統一送信境界）

- **統一送信境界を新設**: `approval-notify` の型を正典に `src/lib/channels/send/`（仮 `secretaryPush.ts`）へ抽出。中身＝entitlement 再確認（feature key はコール側指定・リマインドは既存 **`timed_line_reminders`(Pro)**）→ 二層予算 `decideSharedSendBudget`（`ownerType==='platform'` のみグローバル層）→ 決定的 retryKey → `pushLineMessage` → `insertChannelMessage(billablePush:true)`。宛先解決は境界の外のリゾルバ層（`findIdentityIdsByExternalUserIds`・`selectPreferredActiveGroup`）。
- **既存 `task-reminders` cron を本境界へ載せ替え**（現状 billable_push/二層予算を通さない**課金穴**の是正＝PR-0.5）。digest/chatReply の移行は**宣言のみ**（正典と定め、触るとき寄せる。一斉リライトはしない）。
- **真の境界は cron 送信時の entitlement 再確認**（既存パターン）。
- **宛先**: 担当者（assignee）。優先順: Pro＋`line_direct_dm`＋LINE連携済 → 1:1 DM ／ それ以外の Pro → 発生元チャット（グループはメンション）／ Free → digest 行のみ（**既存の単一 digest push に期限セクションを追記・追加の billable send を作らない**・external 鮮度抑止は同様に適用）。
- v1 は **internal 向け限定**。`chatReplySender` は digest起点group専用で汎用ルーター化しない。

## 10. PR 分割（すべて develop 宛・worktree分離・TDD）

- **PR-0（正本境界＋スキーマ基盤）** — migration-writer + impl-runner:
  `due_authority_connection_id`＋backfill＋`trg_guard_external_due`（WHEN節必須）／`task_due_reminder_occurrences`＋claim/finalize RPC／`last_import_success_at`（全ページ成功後のみ更新）／`_enqueue_connector_job` ヘルパ／`registry.ts` capabilities／gtasks import・multica 起票で権威列セット／UI 読み取り専用。**service-role update サイト棚卸しをマージ条件に添付**。
- **PR-0.5（統一送信境界）** — impl-runner:
  `src/lib/channels/send/secretaryPush.ts` を approval-notify から抽出＋既存 `task-reminders` cron を載せ替え（billable_push 化・二層予算）。
- **PR-1（v1a 送信）** — impl-runner:
  planner cron（occurrence materialize）＋sender cron（claim→§6 3条件→統一境界送信）。channel-digest に Free 向け期限セクション。
- **PR-2（v1b 確認＋設定UI）** — migration-writer + impl-runner:
  `rpc_confirm_task_done_via_line`／`webhookHandler.ts processPostback` に `parseDueReminderDone/Snooze` 追加（digest done と同構造）／設定UI（§8）。

（前回 PR-3 は消滅＝capabilities を PR-0 へ前倒し。空枠は任意の「approval-notify 自身の送信境界載せ替え」に。）

## 11. 検証項目（TDDで先に書く回帰）

**正本境界(A)**: authenticated の external due 変更→`due_managed_externally` でエラー＆楽観更新ロールバック／同 update で title のみ→成功（WHEN節回帰）／service_role(import)で due 上書き→成功／internal(権威NULL)は従来編集可／接続 delete→権威NULL化＝編集復帰／Gantt バードラッグで external タスク不動／**service-role で due_date を書くサイトの棚卸し結果を PR に添付**。

**完了ループ(B)**: [完了]postback 2連打→2回目 `already_done`・complete が接続ごと増えない／並行2リクエスト→single-winner／遷移トランザクション内 enqueue 失敗注入→status も巻き戻る（原子性）／revoked link・他org口座・非メンバー→`forbidden`／spec未確定・open review→`blocked` で遷移0／gtasks+multica 両 link タスクで complete が各接続ちょうど1件／個人ミラー対象で `user_task_mirror_jobs` にも complete（既存回帰）。

**鮮度/送信(C)**: `last_import_success_at` SLA超過→送信0＋suppress_reason／予約時 due と送信時 due 不一致→送らず再スケジュール／接続 expired→送信0／done済→送信0／claim→push成功→finalize前クラッシュ→再送1回・同一 retryKey／insert後未配信クラッシュ→永久ロストしない（lease失効回収）／1タスクに3 offset が独立送信／due変更→旧 occurrence suppressed・新生成／Free org→push0・digest行のみ／Pro失効→送信0／**送信が `billable_push:true` 計上・platform hard で停止**（task-reminders 移行分の回帰含む）／予算抑止→pending復帰・翌窓再送・上限打ち止め／multica-only タスク→occurrence 生成されない／orphan sweep SLA。

## 12. リスク / 不可逆性

- **不可逆に近い**: 「external権威タスクの期限は TaskApp で編集不可」の製品契約（§2.1・維持）。緩める向きにしか動けない＝安全側で正しい。
- **⚠ トリガー hot-path**: `trg_guard_external_due` は全 `tasks` update に載るため **WHEN 節の発火絞り込みを省略しない**（省略＝全更新に判定コスト）。
- **⚠ service_role 素通し**: トリガーでは原理的に塞げない。service-role の due_date 書込みサイト棚卸しを **PR-0 マージ条件**に。
- **⚠ 鮮度の前提**: 「`last_import_success_at` は全ページ poll 成功後のみ前進」が鮮度証明の生命線。import が cursor/updatedMin ベースであること・部分失敗でカーソルを進めないことを実装で担保＋検証。
- 導入する DB オブジェクトはすべて DROP 可逆。残リスク: fail-quiet の「送られなかったリマインド」不可視性（可視化 v2）／スヌーズ乱用（上限で緩和）／統一送信境界を digest/chatReply に強制しない当面の不整合（宣言＋機会移行で許容）。

## 13. Open items（数値のみ・実装時に確定。モデルは確定済）

- `pollFreshnessSlaMinutes` の値＝gtasks import の実 pg_cron 間隔×2（impl時に登録値で定数化）。
- 既定リマインドのオフセット群（○日前/当日/超過）の初期値と org/project 既定の持ち方。
- スヌーズ／超過再通知の送信上限回数。

> 注: タイミング“モデル”（`offset_minutes` による occurrence identity）と鮮度セマンティクス（poll-sla＝接続単位証明・有界遅延許容・multica除外）は**確定**＝PR-0 スキーマに焼き込む。後で変えられるのは数値のみ。

## 14. レビュー経緯（trail）

1. **Fable 初裁定**: 案3改（v1a→v1b）。ただし Opus が渡した前提のうち「サーバ mutation 境界で409」「完了は既存トリガーで伝搬」「承認トークンモジュール再利用」が実コードと相違。
2. **Codex(Plan Reviewer) REJECT**: 正本強制が全書込み経路を守れない／insert-first は配信前クラッシュで永久ロス・複数オフセット表現不可／鮮度は接続単位では task を証明できない／完了 authz・トランザクション伝搬未定義／PR順（capabilities 依存）／課金経路不整合。
3. **Opus 事実確認**: 上記 Codex 指摘4点を実コードで裏取り（直書きRLS・明示 enqueue・`_via_line`型・approval-notify 二層予算 vs task-reminders 直push）。
4. **Fable 再裁定（3クラックス）**: A=BEFORE UPDATE トリガー＋`due_authority_connection_id`／B=`rpc_confirm_task_done_via_line`（トランザクション内 enqueue・口座束縛authz）／C=統一送信境界＋poll-sla 鮮度（cursor全ページ成功で接続単位が全task証明・有界遅延許容・multica除外）。追加事実: `trg_enqueue_task_mirror` は個人ミラー専用／multica は due_date 無し。
5. **本改訂 v2**: 4を反映。
