# AI秘書 Stage 5 設計 — 期限リマインド＋完了確認ループ

> Status: v2実装済（「うざくない秘書」再設計・Fable+Codex一致裁定を反映）/ 起案 2026-07-21・再設計反映 2026-07-22
> レビュー経緯: Fable初裁定 → Codex(Plan Reviewer) REJECT → Opusが実コードで事実確認 → Fable再裁定（3クラックス）→ v1実装
> → 「督促マシン」化の反省を踏まえ Fable+Codex一致裁定で v2（うざくない秘書）へ再設計・実装。§9・§15 参照。
> 関連: [[AI_SECRETARY_STAGE2_6_DUE_ASSIGNEE]], [[AI_SECRETARY_STAGE2_7_APPROVAL]], [[AI_SECRETARY_STAGE3_INTEGRATIONS]],
> [[MULTICA_CONNECTOR_CONTRACT]], [[CLIENT_REMINDER_SPEC]]（相手先向け催促＝別領分・v2）

## 1. 目的 / 非目的

**目的**: タスクに**期限**があれば秘書が担当者に**リマインド**を送り、**完了確認**（「完了しましたか？」）まで行う。外部タスクツール連携を「ミラーするだけ」から「拾い漏れゼロの催促・確認」へ引き上げる。Pro（マルチチャネル×マルチツール連携ハブ）の付加価値の核。訴求は時短でなく**クオリティ（拾い漏れゼロ）**。

**価値の核（狙いの再定義・2026-07-21）**: 「タスクの存在の通知」ではなく「**催促／対応という“行動”を忘れさせないこと＋完了確認**」。タスクツールは“タスクの存在”は思い出させるが“実際に催促/対応したか”は確認しない → **確認ループが非冗長な価値**。特にタスクツール未使用の担当者は期限接近に気づかず催促を丸ごと忘れる。タスクツール併用者への冗長性は**メッセージ意味論（“あなたのタスク期限です”を廃し“対応/催促を”）と §8 設定のオフ**で解消し、**出自による自動弱体化はしない**（§D裁定＝gtasks通知はGoogleアカウント所有者に届くだけでTaskApp担当者との一致保証がない）。

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
- **クラッシュ窓**: push成功→finalize前クラッシュは lease 失効→再送、**決定的 retryKey = f(task_id, due_snapshot, offset_minutes, send_count, 宛先識別子[groupId/externalUserId])** で LINE 側 dedupe。insert後・配信前クラッシュは lease 失効で回収＝永久ロストしない。
  - ⚠ **宛先識別子を含めること**（PR-0.5 の task-reminders HIGH 修正と同じ穴＝同一キーで複数宛先だと LINE dedupe による配信欠落＋billable 過少計上）。**実装前にこの式を確定させてから着手する**（実装焼付け後の変更は再送/欠落の互換問題）。
- **entitlement 抑止の意味論**: 予算/縮退による抑止のみ `deferred`（pending差戻し・翌窓再送）。**`not_entitled`（Free等）は `suppressed` 終端**（deferredにしない＝Free org occurrence が attempt 上限まで空回りするのを防ぐ。昇格後は次の occurrence から届く）。`done`/鮮度不一致/`no_route` も `suppressed` 終端。
- **スヌーズ**: [まだ]/[○日後]＝該当 overdue occurrence を `pending` に戻し `scheduled_at += N日`・`send_count += 1`。上限で `canceled`。

## 7. 完了確認ループ（クラックスB）

Flex（v2・うざくない秘書 再設計後の文面。§9.1参照）:
```
「見積書の送付」の期限が過ぎています。
・完了済みでしたら、下の[完了した]を押してください。
・まだの場合は、ご対応をお願いします。
```
[完了した] [対応中] [明日また確認]

**確認の問いは「完了しましたか？」相当の丁寧な問い1本に統一**（PR-2実装者は問いを増やさない）。
v2（うざくない秘書 再設計）で ball による文面の出し分けは廃止した。postbackセマンティクス
（[完了した]=done／[対応中][明日また確認]=同一のsnooze）は kind/ball 非依存で同一
（ボタンラベルのみ「まだ」→「対応中」、「○日後に再通知」→「明日また確認」に変更・統合は不変）。
「催促しましたか？」の独立ボタン・状態化は引き続き **v2以降の別課題**（催促済みフラグと
その検証手段が要るため持たない）。

- **1トランザクションの RPC** `rpc_confirm_task_done_via_line(p_channel_account_id, p_external_user_id, p_task_id)` に **authz＋single-winner遷移＋監査＋connector complete enqueue** を内包（SECURITY DEFINER・service_role専用grant）。
  - **authz**: `rpc_promote_digest_task_via_line` の型を踏襲＝`channel_user_links`(revoked_at null) で口座×外部ユーザー→内部ユーザー解決＋タスクorg と link org 一致＋space アクセス確認。**client供給 `p_actor` は受けない**。
  - **single-winner＋伝搬**: `update tasks set status='done' where id=? and status<>'done' returning ...`。遷移した時だけ、そのタスクの `connector_task_links` の active 接続へ `_enqueue_connector_job(..., 'complete', {})`（**トランザクション内**＝クラッシュ窓ゼロ）。0行（`already_done`）は**友好的成功**で enqueue 分岐に入らない（二重伝搬なし）。`completionWrite:false` の接続は dispatch worker 側で no-op（registry参照）。
  - **完了ゲート**: `type='spec'` で `decision_state` 未確定、または open review 存在なら `'blocked'` を返し遷移しない（fail-closed・返信「アプリで確認してください」）。
  - 返り: `'done'|'already_done'|'forbidden'|'blocked'` ＋返信用の最小情報。
- **「ちょうど1件の外部 complete」**: `connector_jobs_pending_unique`（partial unique）＋fold/version が接続ごと pending 最新1件を保証、遷移条件付き enqueue が terminal complete を遷移1回=1回に。配達 at-least-once・complete は冪等（`rpc_connector_complete_task` は done 吸収で0行）。
- **postback authz は digest-postback＋`_via_line` 型が正典**（署名 task/action/recipient/expiry トークン機構は**発明しない**＝前回「承認トークンモジュール再利用」は撤回）。
- **個人ミラー**（`trg_enqueue_task_mirror`＝`user_task_mirror_jobs`・担当者個人の gtasks）は同 UPDATE の AFTER で従来通り発火。connector層と二重にならない・触らない。

## 8. リマインド設定UI（TaskApp所有）

- **v1(PR-1) は設定UIなし**: グローバル定数（既定オフセットは v2 で `[-1440, 0, +1440]` → **`[0, +1440]`**（当日＋超過1回）へ変更・§9.1）＋`SEND_HOUR_JST` で planner が materialize（entitlement-blind）。**設定UI（org/project既定＋タスク単位上書き）は PR-2**。
- **粒度（PR-2）**: 組織/プロジェクトの**既定**＋ **タスク単位の上書き**（TaskInspector）。設定は TaskApp データ（外部と無関係）。offset_minutes 群として occurrence planner が参照。撤去した `-1440`（1日前）オフセットはタスク単位の上書きで個別に有効化できる余地としてコードにコメントで残す。冗長と感じるユーザーはここでオフ/縮小（§D の冗長性対応レバー）。
- **事務所単位オンオフ（v2・実装済）**: `org_channel_policy.due_reminders_enabled`（既定true・`settings/organization`）。**更新は `rpc_set_org_due_reminders_enabled(p_org_id, p_enabled)`（SECURITY DEFINER・owner/adminのみ）経由のみ**で、authenticated への直接書込は与えない（`org_channel_policy` は entitlement/課金列を同居させる service-role 専有テーブル。加えて PostgREST の upsert は `on conflict do update set org_id = excluded.org_id, ...` に展開されるため列レベルGRANT方式は行が既に存在する org で必ず permission denied になる・migration `20260721215120` 参照）。false で事務所全体の自動期限リマインドを停止する（planner/senderとも新規生成・送信をしない・§9.1）。個人単位のオフ（`profiles.due_reminder_enabled`・`settings/account`）とは別軸で両方ANDに効く。
- **external権威タスクでも設定可能**: 期限フィールドは読み取り専用（§2.1）だが、隣で「送る/タイミング/宛先/チャネル/スヌーズ」は編集可。UIで「期限は元ツール管理・リマインドは秘書が担当」と役割を明示。
- 規約: 保存ボタンなし・楽観的更新・モーダル禁止（TaskInspector内）。amber は client 可視要素専用＝internal 向け本設定では不使用。
- Free/Pro: 設定UIは両方に見せるが、即時push・個別DM・時刻指定は Pro（§9）。Free（line_direct_dm非保持）は「担当者にDMルートが無い場合、日次digestに載る」旨表示（§9.1・per-task判定）。

## 9. 課金 / ルーティング（クラックスC・統一送信境界）

- **統一送信境界を新設**: `approval-notify` の型を正典に `src/lib/channels/send/`（仮 `secretaryPush.ts`）へ抽出。中身＝entitlement 再確認（feature key はコール側指定・リマインドは既存 **`timed_line_reminders`(Pro)**）→ 二層予算 `decideSharedSendBudget`（`ownerType==='platform'` のみグローバル層）→ 決定的 retryKey → `pushLineMessage` → `insertChannelMessage(billablePush:true)`。宛先解決は境界の外のリゾルバ層。
- **既存 `task-reminders` cron を本境界へ載せ替え**（現状 billable_push/二層予算を通さない**課金穴**の是正＝PR-0.5）。digest/chatReply の移行は**宣言のみ**（正典と定め、触るとき寄せる。一斉リライトはしない）。
- **真の境界は cron 送信時の entitlement 再確認**（既存パターン）。
- v1 は **internal 向け限定**。

### 9.1 うざくない秘書 再設計（v2・実装済・Fable+Codex一致裁定）

v1稼働後、「督促マシン」化（グループへの個別催促・反復回数の可視化・ball起点の命令調）が
UXを損なうと判断し、**私信(DM)=“問い” / 公(グループ)=“中立な予定表”** の原則で再設計した。
反復は同意ベース（スヌーズは相手の操作起点のみ）・完了の出口を常に同梱・**グループに催促文面を
一切出さない**。

- **⚠ ハード契約（§2.1と同格・緩める方向にしか動かさない）: 個人向け催促はグループに出さない。**
  期限リマインドの配信は **DM(1:1)私信のみ**。旧v1にあった §A の3段宛先解決
  （`(1)` DM → `(2)` 発生元チャットグループ → space の active グループ）のうち **tier-2以降
  （グループへの個別催促フォールバック）は撤去**した。DM解決できたときだけ送信し、できなければ
  **`suppressed('no_route')`** で終端する（`src/app/api/cron/due-reminder-sender/route.ts` の
  `resolveDestination` はDM候補以外を一切返さない）。安全網は下記の channel-digest 期限セクション
  （中立文面）のみが担う。
  - **`assignee_id` が NULL のタスクは occurrence を生成しない**（曖昧な宛先の fallback を作らない）。
  - **ball は宛先も文面も変えない**（旧v1は ball=client で「相手先への催促」文言を出し分けていたが
    廃止。内側担当者への同一の丁寧な「問い」に統一・`dueReminderMessages.ts`）。
- **事務所単位オンオフ**: `org_channel_policy.due_reminders_enabled`（既定true・coalesce）。
  falseなら planner が新規occurrenceを作らず、sender も既存occurrenceを
  `suppressed('org_reminders_disabled')` で終端する。entitlement再確認と同じ位置づけの
  送信境界ゲート（`isOrgDueRemindersEnabled`）。owner/adminが `settings/organization` で
  オンオフでき、列レベルGRANTで当該列のみ更新可（他のentitlement列は保護）。
- **個人単位オンオフ**（既存・v1から不変）: `profiles.due_reminder_enabled`（`settings/account`）。
  事務所単位と個人単位は独立の2段ゲートでANDに効く。
- **既定オフセットの縮小**: `[-1440, 0, +1440]`（1日前/当日/超過1回）→ **`[0, +1440]`**
  （当日/超過1回のみ）。「1日前」の事前リマインドは反復回数を増やすため既定から撤去した
  （`dueReminderPlanner.DUE_REMINDER_OFFSETS_MINUTES`）。撤去した `-1440` はタスク単位の
  将来の上書き設定（§8）向けにコードコメントで残し、`offsetToKind`/`buildDueReminderOccurrenceDrafts`
  は引き続き負値を扱える（後方互換）。
- **DM文面（`dueReminderMessages.buildDueReminderText`）**: 「（N回目の再通知です）」の表示を廃止
  （反復回数の可視化が督促の圧を増すため）。ball起点の命令調（「相手先に催促をお願いします」等）も
  廃止し、内側担当者への同一の丁寧な「問い」に統一:
  ```
  「{title}」が{本日/明日}期限です。
  ・完了済みでしたら、下の[完了した]を押してください。
  ・まだの場合は、ご対応をお願いします。
  ```
  ボタンは **[完了した][対応中][明日また確認]**（postbackアクションは done/snooze/snooze。
  旧「まだ」「○日後に再通知」は同一アクションのため統合。RPC・postback機構・
  send_count焼き込み＝リプレイ防御は不変・§7）。
- **channel-digest の期限セクション＝安全網（中立文面・per-task判定に刷新）**:
  - **client_scope安全（★安全修正）**: `findDueDigestCandidatesForSpace` に
    `client_scope='deliverable'` フィルタを追加。旧実装はこのフィルタが無く、内部専用タスク
    （`client_scope='internal'`）が相手先も見える可能性のあるグループのdigestに漏れる穴が
    あった。
  - **掲載条件をper-task「DMで届かない場合」に変更**（旧v1は「`timed_line_reminders` 非保持org
    のみ」に出す org 単位の判定だった）。担当者ごとに、org が `line_direct_dm` を保持し、かつ
    `channel_user_links` に active な紐付け（`findUserIdsWithActiveLink`）があれば、そのタスクは
    DMで届く＝digestには出さない（重複防止）。DMルートが無いタスクだけ載せる。org単位オンオフ・
    個人単位オプトアウト（`profiles.due_reminder_enabled`）・§6鮮度抑止も同様に適用する。
    「DMで届くか」の判定は `findUserIdsWithActiveLink` が `channel_user_links`(revoked_at is null)
    に加えて紐付け先 `channel_accounts.status='active'` も見る（sender側 `resolveDmCandidate`
    の判定基準と対称化・是正済み）。
  - **解消済み: DM到達不能マーク・解除ループ＝A案（webhook単独の対称ループ）**（旧「既知の穴」
    を解消。2度のレビューを経て確定した設計）。上記の「DMルートがある」判定は account/紐付けの
    **状態**（active/revoked）のみを見ており、LINE側で相手がBotをブロックした等の理由で
    **実際には届かない**ケースまでは検知できず、「DMルートあり」と誤判定してdigestからも除外
    され、当該タスクがDM・digestのどちらからも実質的に見えなくなる（恒久的な可視性喪失）穴が
    あった。
    - **⚠ H-1（前提の誤り・確定した結論=「push結果は到達性について何も語らない」）**:
      LINE Messaging APIは「フォロー後にブロックしたユーザー」宛のpushでも**2xxを返し
      メッセージを黙って捨てる**仕様（ブロック有無をpushから観測させない）。これは
      push失敗（4xx）だけでなくpush**成功**にも同じ論理が及ぶ: `delivered:true`はDMが
      実際に届いた証拠にならない。
      - 初版（旧M-1/M-4）はmark側のみをwebhook起点に直したが、**clear側にpush成功トリガが
        残っており片手落ちだった（H-1'）**: unfollowで正しくマーク→翌日digestが拾う→
        その日のリマインド送信が200を返すだけで`clearDmUnreachable`が走りマークが消える→
        翌日から再び恒久的に不可視へ戻る。しかも当人は既にunfollow済みで**unfollowイベントは
        二度と来ない＝再検知不能**という致命的な再発だった。
      - push失敗側も同様に問題がある（M-1'）: 「宛先起因に見える」400/404は実態としては
        LINE API側のボディ検証エラー（タイトル長超過等）が大半を占め、宛先の生死とは無関係に
        同一cronで最大100件が一斉に誤マークされ、相手先も見えるグループのdigestへ一斉掲載
        される事故になり得る。
      - **結論（A案）: push結果（成功・失敗いずれも）は mark/clear の一切のトリガにしない。**
        `src/app/api/cron/due-reminder-sender/route.ts` はDM到達不能マーク・解除に一切関与
        しない（`resolveDmCandidate`＝宛先解決ロジックのみで、マークの有無を読みも書きも
        しない）。`isPermanentLinePushFailure` と
        `finalizeDueReminderOccurrence('suppressed', 'push_failed_permanent')` の関係
        （occurrenceのライフサイクル）は不変。
    - **唯一のトリガ＝ webhook の `unfollow`/`follow`（対称ループ）**
      （`src/lib/channels/line/webhookHandler.ts`）:
      - `unfollow`（ブロック）受信 → `markDmUnreachable(orgId, channelAccountId,
        externalUserId, event.occurredAt)`。
      - `follow`（再開・ブロック解除）受信 → `clearDmUnreachable(orgId, channelAccountId,
        externalUserId, event.occurredAt)`。
      - `follow`分岐は記録処理（`recordSystemEvent`・挨拶送信）より**先に**clearを呼ぶ
        ベストエフォート（失敗してもwebhook本処理は継続。dedupe再送・disabledアカウントでも
        呼ぶ。clearは冪等かつ後述のイベント順序ガードがあるため先出しの実害が無い）。
      - `unfollow`分岐は`recordSystemEvent`の**後**にmarkを呼ぶ（M-2是正・後述）。
      - DM linkを持ちうるのは複合FK上 `owner_type='org'`（自社LINE）のみのため、
        `owner_type='platform'`（共通LINE）の分岐では呼ばない（該当分岐は元々早期returnする）。
    - `findUserIdsWithActiveLink`（`src/lib/channels/store.ts`）は
      `dm_unreachable_at is null` を絞り込み条件に追加。マーク済みlinkは「DMルート無し」
      とみなされ、digestの期限セクション（安全網）に拾い直される。
    - **テナント境界（L-3）**: `markDmUnreachable`/`clearDmUnreachable`は`orgId`引数を取り
      `.eq('org_id', orgId)`も掛ける。現状DM linkを持てるのは`owner_type='org'`のみで越境の
      実害は無いが、将来共通LINEで1:1が解禁され同一`external_user_id`が複数orgに跨る行を
      持つようになった場合、1回のupdateが他orgの行まで書き換える事故を安価なうちに予防する。
    - **イベント順序（clear側のガード・L-4）**: `now()`ではなく`event.occurredAt`（LINE
      イベントの発生時刻）を書き込む。`clearDmUnreachable`は`dm_unreachable_at <
      event.occurredAt`のときのみ解除するイベント順序ガードを掛ける（`.lt`＝同一ミリ秒
      では解除されない。LINEの同一ユーザーのイベントが同一ミリ秒に一致するのは実務上
      発生しない前提）＝現在のマークがこのfollowイベントより**前**に付けられたときだけ
      解除が成立する。LINEの再送等で「新しいunfollow」の後に「古いfollow」が遅延到着しても、
      新しいマークを誤って消さない。
    - **⚠ M-2（unfollow再送による恒久固着・是正済み）**: mark側は`.lt`のような列単独の
      順序ガードを持たない（clearはNULLへ戻すため「いつ解除されたか」を保持する列が無く、
      対称のガードには追加の列＝migration対象・本PR範囲外が要る）。ガード無しでmarkを
      無条件に実行すると次の恒久固着が起きる: T1でunfollow→mark(T1)。応答タイムアウト等で
      LINEがunfollow(T1)を再送予約した直後、T2でユーザーがブロック解除→follow(T2)→
      `T1 < T2`でclear成立。その後LINEがunfollow(T1)を**再送**すると、ガード無しのmarkが
      再実行され`dm_unreachable_at=T1`が復活する。当人は既にfollow済みで**次のunfollow/
      followが起きるまで復旧しない**（毎日digestに載り続け、かつDMも実際には届くという
      二重掲示が恒久化する）。
      - **対策（実施済み）**: `unfollow`分岐は`recordSystemEvent`（`externalMessageId
        =webhookEventId`でdedupe）を**先に**呼び、戻り値が`'duplicate'`ならmark自体を
        呼ばない。同一webhookEventIdの再送は必ず`'duplicate'`になる契約（`follow`側の
        挨拶抑止と同じ機構）を使い、再送でのmark復活を未然に防ぐ。
      - **この対策の代償（M-3(a)として下記に整理）**: `recordSystemEvent`自体がthrowすると
        （mark呼び出しに到達する前に）markが実行されず、一過性DB障害でマークを取りこぼしうる。
        「取りこぼし（次回何らかのイベントで再度チャンスがある）」の方が「恒久固着」より実害が
        小さいと判断しこの順序を採用した。
    - **対象の限定（L-0）**: `markDmUnreachable`/`clearDmUnreachable`のupdateは
      `revoked_at is null` の生きているlinkのみを対象にする。
    - **⚠ 残余リスク（M-3・webhook単独依存であることの限界）**:
      - **(a) unfollowの取りこぼし＝穴の再発かつ再検知不能**: `handleLineWebhook`は
        per-eventで例外を握って必ず200を返し（LINE側の再送ループを防ぐため）、
        `markDmUnreachableBestEffort`も失敗を`console.error`するだけで再試行しない。
        unfollow受信時（または上記M-2対策により先行する`recordSystemEvent`）に一過性DB
        エラーが起きるとマークは永久に失われ、**LINEは同じunfollowを再送しない**（我々が
        200を返すため）→ その担当者は元の恒久不可視に戻る。
      - **(b) 導入前から既にブロック済みのユーザーは永久にマークされない**
        （バックフィルなし）。
      - **将来の和解手段（別PR）**: `GET /v2/bot/profile/{userId}` がブロック済み/未友だち
        で404を返す性質を使い、active linkのみを対象にした日次照合ジョブでmark/clearを
        突き合わせれば(a)(b)両方を吸収できる（LINEのレート制限を考慮した設計が必要）。
    - **運用可視性（次段の課題）**: 現状オペレーター/利用者がdm_unreachable状態を確認する
      UIが無い。`src/app/api/onboarding/line-status/route.ts`（連携状態API）に「現在DMが
      届いていません」の導線を出すことを次段の課題とする（本PRの範囲外）。
  - **中立文面**（`buildDueDigestSectionText`）。催促・ball起点の文言は一切出さない:
    ```
    【期限のお知らせ】{JST日付}
    完了済みのものは各タスクで「完了」に、未対応のものはご対応をお願いします。

    ■ 本日が期限
    ・{title}
    ■ 期限超過
    ・{title}
    ```
    見出しは既定オフセットの粒度（当日/超過）に揃え、「明日が期限(due_soon)」の見出しは持たない
    （既定オフセットから1日前リマインドを撤去したことと平仄を合わせる）。
  - **完了サジェスト（自動完了禁止）**: 中立文面の2行目「完了済みのものは各タスクで『完了』に、
    未対応のものはご対応をお願いします」は、ユーザーへ完了操作を促す**文面上のサジェストのみ**。
    グループdigestからタスクを自動的に `done` へ遷移させる処理は一切行わない（ball遷移と同じく
    v1の非目的§1を継承。誤操作/誤解による意図しない完了を防ぐ）。
- **Free（line_direct_dm非保持）**: push ルートに入らず、per-task判定でも常にDM無し扱いのため
  該当タスクは全て**channel-digestの期限セクション**（安全網）に出る。
- `chatReplySender` は digest起点group専用で汎用ルーター化しない（不変）。

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

- `pollFreshnessSlaMinutes` = gtasks import の実 pg_cron 間隔×2（**確定=30分**＝`*/15`×2）。
- 既定リマインドのオフセット群（PR-1 はグローバル定数 `[-1440, 0, +1440]`＝1日前/当日/超過1回 → **v2（うざくない秘書 再設計）で `[0, +1440]`＝当日/超過1回のみへ縮小・§9.1**）。org/project/task 設定は PR-2（§8）。
- `SEND_HOUR_JST`（送信時刻・offset とは分離。**仮 9:00**）。
- materialize grace（**過去 `scheduled_at < now − 24h` は生成しない**＝ロールアウト時の過去期限一斉送信防止。仮 24h）。
- スヌーズ／超過再通知の送信上限回数（PR-0 finalize の `attempt` 上限・仮値）。

> 注: タイミング“モデル”（`offset_minutes` による occurrence identity）と鮮度セマンティクス（poll-sla＝接続単位証明・有界遅延許容・multica除外）は**確定**＝PR-0 スキーマに焼き込む。後で変えられるのは数値のみ。

## 14. レビュー経緯（trail）

1. **Fable 初裁定**: 案3改（v1a→v1b）。ただし Opus が渡した前提のうち「サーバ mutation 境界で409」「完了は既存トリガーで伝搬」「承認トークンモジュール再利用」が実コードと相違。
2. **Codex(Plan Reviewer) REJECT**: 正本強制が全書込み経路を守れない／insert-first は配信前クラッシュで永久ロス・複数オフセット表現不可／鮮度は接続単位では task を証明できない／完了 authz・トランザクション伝搬未定義／PR順（capabilities 依存）／課金経路不整合。
3. **Opus 事実確認**: 上記 Codex 指摘4点を実コードで裏取り（直書きRLS・明示 enqueue・`_via_line`型・approval-notify 二層予算 vs task-reminders 直push）。
4. **Fable 再裁定（3クラックス）**: A=BEFORE UPDATE トリガー＋`due_authority_connection_id`／B=`rpc_confirm_task_done_via_line`（トランザクション内 enqueue・口座束縛authz）／C=統一送信境界＋poll-sla 鮮度（cursor全ページ成功で接続単位が全task証明・有界遅延許容・multica除外）。追加事実: `trg_enqueue_task_mirror` は個人ミラー専用／multica は due_date 無し。
5. **本改訂 v2**: 4を反映。v1a/v1b実装・稼働。

## 15. うざくない秘書 再設計（v2・Fable+Codex一致裁定・実装済 2026-07-22）

v1稼働後、「督促マシン」化（グループへの個別催促フォールバック・スヌーズ回数の可視化・
ball起点の命令調文面）がUXを損なうと判断し、Fable と Codex(Plan Reviewer) の一致裁定で
再設計した。骨子＝**私信(DM)=“問い” / 公(グループ)=“中立な予定表”**。反復は同意ベース・
完了の出口を常に同梱・**グループに催促文面を一切出さない**。詳細は §9.1 に統合。

変更点の要約（詳細は各節を参照）:
- 配信＝DM(1:1)私信のみ。グループへの個別督促フォールバック（tier-2/3）を撤去（§9.1）。
- 事務所単位オンオフ `org_channel_policy.due_reminders_enabled`（既定true・§9.1・§8）を追加。
- channel-digestの期限セクションを「安全網」として再設計: `client_scope='deliverable'`
  フィルタ追加（★安全修正）・per-task「DMで届かない場合」判定・中立文面・個人オプトアウト
  適用（§9.1）。
- DM文面から「N回目の再通知」表示・ball起点の命令調を撤去し、丁寧な問い＋完了サジェストへ
  統一（§9.1・§7）。
- 既定オフセット `[-1440,0,+1440]` → `[0,+1440]`（1日前を撤去・§9.1・§13）。
- 完了確認Flexのボタンラベルを [完了した][対応中][明日また確認] に変更（postbackアクションは
  done/snooze/snoozeで不変・§7）。

**据え置き（本裁定でも変えていない）**: 正本境界(§2/§5)・staleness 3条件(§6)・完了確認RPCの
authz/トランザクション設計(§7)・統一送信境界とentitlement再確認(§9)・PR分割の既存成果物(§10)。
