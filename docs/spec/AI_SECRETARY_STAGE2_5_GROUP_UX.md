# AI秘書 Stage 2.5: グループ運用の現実対応パック

実機E2E（2026-07-13）で得たフィードバックへの対応設計。対象は3点のうち①②（③digest圧縮=上位N件＋アクションページは後続PRに分離）。

> フィードバック原文の要旨:
> ① グループごとに「全部拾う/メンションだけ拾う」を設定で分けたい
> ② 完了ボタンを誰でも押せてしまう。人数が多いグループでは誤タップが頻発する
> ③ タスク件数が多いとdigestメッセージが画面を占有しすぎる（→後続PR）

## 1. 拾い方モード `channel_groups.pickup_mode`

### DDL（新規migration: `YYYYMMDDHHMMSS_group_pickup_mode.sql`）

```sql
alter table public.channel_groups
  add column if not exists pickup_mode text not null default 'all'
  check (pickup_mode in ('all', 'mention_only', 'off'));

-- 既存の digest_enabled=false は off へ引き継ぐ
update public.channel_groups set pickup_mode = 'off' where digest_enabled = false;

comment on column public.channel_groups.pickup_mode is
  '申し送りの拾い方: all=夜間LLM全文抽出 / mention_only=botメンションのみ即時タスク化 / off=抽出・digest配信とも停止。digest_enabled は本列に置換され deprecated（読み取り禁止）';
```

- `digest_enabled` 列は残す（ロールバック安全のため）が、**コードからの読み書きは全廃**する。
- 共有本番DBのため適用は psql 個別適用＋`applied_migrations` へのINSERT記録（運用メモどおり）。

### 意味論

| mode | 夜間LLM抽出 | メンション即時タスク化 | 朝digest配信（openタスクの再採番＋push） |
|------|------------|----------------------|----------------------------------------|
| `all`（既定） | する | しない（夜間抽出で拾うため。二重登録防止） | する |
| `mention_only` | しない | する | する（openタスクがあれば） |
| `off` | しない | しない | しない |

- `off` が止めるのは上表のパイプライン3段のみ。**完了操作（「完了N」テキスト・過去digestのボタン・取り消し）は off でも受理する**。実際のユーザー操作の反映と証跡記録は pickup_mode と独立、という disabled アカウントと同じ原則。

### コード変更

- `store.ts`: `ChannelGroup` に `pickupMode: 'all' | 'mention_only' | 'off'` を追加（`GROUP_COLUMNS`・`toChannelGroup`・`GroupRow` 更新）。`digestEnabled` フィールドは削除。
- `findDigestEligibleGroups()`: `eq('digest_enabled', true)` → `.neq('pickup_mode', 'off')`。返り値に `pickupMode` を含める（cronが抽出可否を判定するため）。
- cron `channel-digest/route.ts`: `group.pickupMode === 'all'` のときだけLLM抽出ブロックを実行。再採番＋push は従来どおり全eligibleグループで実行。
- PATCH `/api/channels/groups`: `digestEnabled` パラメータを廃止し `pickupMode`（3値のバリデーション）を受ける。UI消費者はまだ存在しないため互換対応は不要。
  - **`all` への切替時は `last_extracted_message_created_at = now()` に更新する**（mention_only/off 期間中の溜まったバックログを一括LLM投入しないため。切替前の発言は拾わない仕様と明記）。
- `updateChannelGroup`: `pickupMode` と watermark更新に対応。

## 2. メンション即時タスク化（`mention_only` のみ）

### イベント正規化（`events.ts`）

LINE textメッセージの `message.mention.mentionees[]` を解析:

- `mentionees[].isSelf === true` の要素があれば bot宛メンションとみなす。
- `NormalizedLineEvent` に `mentionsSelf?: boolean` と `selfMentionSpans?: Array<{ index: number; length: number }>`（isSelf要素の位置。本文からメンション文字列を除去するため）を追加。text以外・mentionなしは undefined。
- 監査用に `payload.mentionsSelf = true` も記録する（trueのときのみ）。

### webhookHandler（`processGroupMessage`）

text メッセージの既存分岐（完了コマンド→リンクコード）の**後**に追加:

```
if (group.pickupMode === 'mention_only' && event.mentionsSelf) → 即時タスク化パス
```

1. まず通常どおり `insertChannelMessage`（groupMessageRecord）で記録し、戻りの `{id}` を `source_message_id` に使う。`'duplicate'`（webhook再送）なら以降を行わない。
2. account が disabled なら記録のみで終了（digest系の自動動作は disabled で停止、の既存原則に従う）。
3. title = 本文から `selfMentionSpans` の区間を除去 → `sanitizeDigestTitle`（既存の50字・制御文字除去）。空になったら**タスクを作らず** reply「内容が読み取れませんでした。メンションに続けて申し送り内容をお書きください。」
4. `createInstantDigestTask(store.ts 新関数)`: `channel_digest_tasks` へ INSERT（org_id/space_id はgroupからデノーマライズ、`extracted_date` はJST日付=`formatDateToLocalString`、`toISOString().split` 禁止）。unique(source_message_id, title) 競合は握って冪等成功扱い。
5. reply（replyToken・通数無料）:「申し送りに追加しました。\n『{title}』」
6. reply本文も channel_messages に outbound 記録（既存パターン踏襲）。

補足: `all` モードではメンションでも何もしない（夜間抽出で拾われる。source_message_id は同じでも title がLLM要約と異なると unique 制約をすり抜けて二重になるため、経路自体を分ける）。

既知の限界: 手順1のメッセージ記録成功後・手順4のタスクINSERT前にプロセスが落ちると、webhook再送は `'duplicate'` で早期returnするためそのメンションのタスクは作られない（mention_only は夜間抽出のバックフィルが無い）。発生確率が低く、既存の「記録成功＋reply未達」と同型のトレードオフとして許容する。

## 3. 完了の記名化＋取り消し（誤タップ対策）

方針: LINEは確認ダイアログを出せないため「押させない」ではなく「**誰が押したか見える＋すぐ戻せる**」で誤タップを吸収する。

### 3-1. 記名化

- `client.ts` 新関数 `fetchGroupMemberProfile(accessToken, groupId, userId)` → `{ displayName: string } | null`。
  `GET https://api.line.me/v2/bot/group/{groupId}/member/{userId}/profile`。**ベストエフォート**: 非2xx・例外は null（完了処理は止めない）。
- 完了reply文言:
  - 表示名あり:「{displayName}さんが『{title}』を完了にしました。」
  - なし（匿名メンバー・API失敗）: 従来どおり「『{title}』を完了にしました。」
- 対象: postback（完了ボタン）と「完了N」テキストの両経路。

### 3-2. 取り消し（undo）

- 完了replyを **Flex Message 1通**にする: body=上記の記名文言、footer=「取り消す」ボタン（postback）。`compute.ts` に `buildTaskDoneFlexMessage({ title, doneByDisplayName, taskId })` を追加（サーバ側テンプレート合成のみ・LLM出力はtitleのみ、の既存原則を維持。displayNameはLINE APIから来る非信頼文字列なので `sanitizeAssigneeHint` 相当のサニタイズを通す）。
- `postback.ts`: `action=digest_undo&task=<uuid>` の build/parse を追加（既存 digest_done と同型・isValidUuid検証）。
- `store.ts` 新関数 `reopenDigestTaskAtomic(taskId)`:
  ```
  update channel_digest_tasks
  set status='open', done_at=null, done_via=null, done_by_external_user_id=null
  where id=? and status='done' and done_at > now()-interval '24 hours'
  returning id, title
  ```
  0行なら「取り消せない」（既にopen/dismissed、または24時間超過）。**24時間制限**はトーク履歴に残った古いボタンからのゾンビreopen防止。
- webhookHandler `processPostback`: action種別で分岐。digest_undo も digest_done と**同一の検証チェーン**（task→group→account→org一致、groupId一致）を通す。結果:
  - 成功reply:「『{title}』を申し送りに戻しました。」（明日の朝digestに再掲される）
  - 失敗reply:「取り消せませんでした（完了から24時間以上経過、または既に戻されています）。コンソールからも戻せます。」
  - rejected（検証不一致）は既存どおり無応答。
  - channel_messages への postback 証跡記録は既存 digest_done と同型（`action: 'digest_undo'`, result）。
- reopen で sink の `task.reopened` が既存DBトリガーから配達される（追加実装不要。Notion/Sheets側も status が open に戻る）。
- digest_number は done 時点の値が残っているため、reopen 後も「完了N」が引き続き機能する（翌朝の再採番で正規化される）。

## 4. テスト（TDD・Red→Green→Refactor）

既存テストファイルに追加（新規は store 関数分など必要最小限）:

- `events.test.ts`: mentionees の isSelf true/false/欠落/非text で `mentionsSelf`・`selfMentionSpans` の正規化。
- `compute.test.ts`: `buildTaskDoneFlexMessage`（記名あり/なし・undo postback data・title/displayNameサニタイズ）。メンション除去→titleの導出ロジック（純関数 `buildMentionTaskTitle(body, spans)` として compute.ts に置く）。
- `postback.test.ts`: digest_undo の build/parse・不正UUID拒否・digest_doneとの判別。
- `webhookHandler.test.ts`:
  - mention_only×メンション→タスク作成＋reply／duplicate再送で作らない／disabledで作らない／title空でガイダンスreply
  - all×メンション→何もしない／off×通常発言→記録のみ
  - postback digest_undo: 成功reply・24h超過/既にopenの失敗reply・他グループ/他org rejected 無応答
  - 完了replyの記名（profile成功/失敗フォールバック）
- `channel-digest-route.test.ts`: mention_only グループでLLM抽出が呼ばれない＆openタスクは配信される／off が対象外。
- store系: `reopenDigestTaskAtomic`・`createInstantDigestTask` はモックSupabaseの単体（既存 `updateDigestTaskStatusConsole.test.ts` と同型）。

## 5. 受け入れ確認（実機）

1. コンソールAPIで対象グループを `mention_only` に切替 → 夜間cronがLLMを呼ばない（skipped/extractedTasks=0）
2. グループでbotメンション「@AgentPM秘書 金曜までに見積提出」→ 即reply＋openタスク作成（title=メンション除去済み）
3. 朝digest（手動発火）にそのタスクが載る
4. 完了ボタン→「◯◯さんが…完了にしました」＋取り消すボタン → 取り消す→openに戻り sink に task.reopened が配達
5. 24時間経過後の取り消し（DBでdone_atを偽装）→ 失敗reply
6. `off` グループ → digest配信されない

## 6. 後続PR（本PRに含めない）

- ③ digest圧縮: 一覧を上位N件＋「残りM件はこちら」リンク（ログイン不要アクションページ=トークンポータル）。Flexカルーセルは次点案。
- 完了操作の権限制限オプション（突合済みメンバーのみ）— 摩擦が大きいため要望が出てから。
- グループ設定のコンソールUI（現状PATCH APIのみ。UIは秘書コンソールのグループタブ新設時に）。
