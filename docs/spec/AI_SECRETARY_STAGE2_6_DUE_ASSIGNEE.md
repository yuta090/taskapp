# AI秘書 Stage 2.6 — 申し送りの「期限（日付＋時刻）」と「担当」

Stage 2 / 2.5 で作った申し送り（`channel_digest_tasks`）は **タイトルしか持っていない**。
「金曜17時までに山田さんが酒屋へ発注」という発言から、期限も担当も落ちている。
本仕様は digest 側だけで完結する形で **期限（日付＋時刻）** と **担当** を持たせる。

**本体 `tasks` への昇格は本仕様の対象外**（§7 に論点だけ残す）。

---

## 1. 設計の骨子

### 1-1. 担当は「3段」で持つ

LINE の `mention.mentionees[].userId` は **type=user かつ本人がプロフィール取得に同意している場合のみ** webhook に含まれる。
未同意・未友だちのメンバーをメンションしても userId は来ない。
よって「メンションすれば必ず人が特定できる」前提は置けない。**名前は常に取れる／人は取れたら取る** の2層構造にする。

| 列 | 役割 | 取得元 |
|----|------|--------|
| `assignee_hint` (既存) | **常に埋める** 担当者名の自由文字列（ラベル） | メンション表示名 or LLM抽出 |
| `assignee_external_user_id` (**新設**) | LINE userId。identity 未作成でも生で残す | mentionee.userId |
| `assignee_identity_id` (既存・**未使用**) | `channel_identities` への参照＝人単位の管理 | userId → identities 解決 |

`assignee_hint` / `assignee_identity_id` は **DDL に既にあるが一度もコードから書かれていない**
(`supabase/migrations/20260711073329_channel_groups_digest.sql:157-159`)。受け皿は既に存在する。

`assignee_external_user_id` を別に持つ理由は **後からの昇格**。
メンション時点で友だち未追加＝identity なしでも userId を残しておけば、
その人が後で友だち追加した瞬間に過去分を identity へバックフィルできる（§6）。
`done_by_external_user_id` と同じ設計（生の external id を残す）に揃える。

### 1-2. 担当の決定は「メンション優先・LLMは補助」

優先順位（上が強い）:

1. **他人宛メンションで userId が取れた** → `hint` + `external_user_id`(+ 解決できれば `identity_id`)
2. **他人宛メンションだが userId なし**（未同意） → `hint` のみ（本文のメンション文字列から切り出す）
3. **メンションなし・LLMが本文から読んだ名前** → `hint` のみ

メンションは発話者の明示的な指名であり、LLM の推測より確実。**LLM の `assignee_hint` でメンション由来の担当を上書きしない**。

### 1-3. 期限は日付＋時刻。時刻は任意（null = 終日）

| 列 | 型 | 意味 |
|----|-----|------|
| `due_date` (**新設**) | `date` | JST日付。null = 期限なし |
| `due_time` (**新設**) | `time` | JST時刻。**null = 終日**（「17時まで」等の明示があるときだけ入る） |

**`timestamptz` にしない理由**: 本体 `tasks.due_date` が `date` 型（`20240101_000_schema.sql:65`）で、
ガント／バーンダウン／リマインドメールが日付粒度前提。将来本体へ昇格するとき `date` 同士でそのまま渡せる形にしておく。
時刻は LINE 上の表示・リマインドだけが使う情報として digest 側に閉じる。

**日付ずれ禁止**: 相対日付の解決も保存も JST。`toISOString()` は使わず `formatDateToLocalString` を通す（CLAUDE.md）。

---

## 2. スキーマ差分

`supabase/migrations/<YYYYMMDDHHMMSS>_digest_due_assignee.sql`

```sql
alter table public.channel_digest_tasks
  add column if not exists due_date date,
  add column if not exists due_time time,
  add column if not exists assignee_external_user_id text;

comment on column public.channel_digest_tasks.due_date is
  '期限日（JST。formatDateToLocalString で生成・toISOString禁止）。null=期限なし';
comment on column public.channel_digest_tasks.due_time is
  '期限時刻（JST）。null=終日（時刻の明示がなかった）。本体tasksはdate粒度のため時刻はdigest側に閉じる';
comment on column public.channel_digest_tasks.assignee_external_user_id is
  'メンションで取れたLINE userId。identity未作成でも生で残し、後の友だち追加時にidentityへバックフィルする';

-- 期限リマインド（§5）の走査用。open かつ期限ありだけを対象にする部分索引
create index if not exists channel_digest_tasks_due_open
  on public.channel_digest_tasks(due_date, due_time)
  where status = 'open' and due_date is not null;
```

`unique (source_message_id, title)` は**変更しない**。期限・担当は重複判定に含めない
（同一発言から同一タイトルが再抽出されたら、期限が違っても同一タスク）。

`rpc_ingest_digest_tasks` の `p_tasks` jsonb 要素に
`due_date` / `due_time` / `assignee_external_user_id` / `assignee_identity_id` を追加（`create or replace`。引数シグネチャは不変）。

---

## 3. メンション情報の取得（ここが全ての前提）

### 現状の欠落

- `src/lib/channels/line/events.ts:14` の `LineMentionee` に **`userId` がない**（捨てている）
- `events.ts:175` は `payload` に `mentionsSelf` しか保存しない
  → **夜間一括抽出（`all` モード）では「誰宛のメンションだったか」を復元できない**

### 差分

1. `LineMentionee` に `userId?: string`、`type: 'user' | 'all'` を追加
2. `NormalizedLineEvent` に `mentionees` を追加（self / 他人の両方）
3. **`channel_messages.payload` に `mentionees` を保存する**（他人宛メンションを含む）。
   これがないと `all` モードの夜間抽出で担当を復元できない。
   保存するのは `{index, length, type, userId?, isSelf?}` のみ（表示名は本文の span から切り出す）
4. `type: 'all'`（@all）は**担当と見なさない**（全員宛＝指名ではない）

---

## 4. 抽出パスの差分

### 4-1. `mention_only`（即時タスク化・`webhookHandler.ts:752` `handleMentionInstantTask`）

現状は bot宛メンションを検知して `title` だけで `createInstantDigestTask` している。

- **担当**: 本文中の**非self メンション**から決定。
  - 1件 → その人を担当（§1-2）
  - 複数 → **先頭1件を担当**、残りはタイトル本文にそのまま残る（担当は単数で持つ。複数担当は「誰も自分ごとにしない」を招くため意図的に単数）
  - 0件 → 担当なし（本文のLLM解釈はこのパスでは行わない＝即時性を優先）
- **期限**: 本文から解決する（§4-3）。即時パスは LLM を通していないので、
  ここだけ**軽量な日本語日時パーサ**（`lib/channels/digest/dueParse.ts`）を通す。
  「明日」「金曜」「7/17」「17時まで」「今週中」を規則で拾い、解けなければ null。
- 返信文に期限・担当を含める:
  `申し送りに追加しました。\n『酒屋へ発注』\n期限: 7/17(金) 17:00 / 担当: 山田さん`

### 4-2. `all`（夜間LLM抽出・`digest/compute.ts`）

抽出プロンプト（`compute.ts:71` `buildDigestExtractionPrompt`）の出力形式を拡張する。

```json
{"title": "50字以内の要約",
 "assignee_hint": "担当者名(不明ならnull)",
 "due_date": "YYYY-MM-DD(不明ならnull)",
 "due_time": "HH:MM(時刻の明示がなければnull)",
 "source_index": 元メッセージのindex}
```

- **相対日付の解決に基準日時を渡す**: プロンプトに `現在は 2026-07-14(火) 10:30 JST です` を注入し、
  「明日」「金曜まで」「今週中」を絶対日付に解決させる。
  基準日時は `formatDateToLocalString` 系で組み立てる（`toISOString` 禁止）。
- **メンション由来の担当を優先**: `source_index` から元メッセージの `payload.mentionees` を引き、
  非self メンションがあれば LLM の `assignee_hint` を**捨ててメンション側を採用**する（§1-2）。
- 「今週中」「月内」等は**期間の終端**（金曜／月末）に丸める。解けなければ null。

### 4-3. 期限のバリデーション（LLM/パーサ共通・`dueParse.ts`）

LLM は年を間違える・過去日を返す。**保存前に必ず落とす**:

- `YYYY-MM-DD` / `HH:MM` の形式に一致しなければ null
- **基準日より過去** → null（「昨日までに」は期限として無意味）
- **基準日 +180日 より先** → null（年の取り違え除け）
- `due_time` があって `due_date` が null → **`due_time` も null に落とす**（時刻だけの期限は保持しない）

---

## 5. 表示とリマインド

### 5-1. digest 配信の行フォーマット

```
1. 酒屋へ発注  ⏰7/17(金) 17:00  👤山田さん
2. 請求書の確認  ⏰7/15(水)
3. 議事録の共有
```

- 期限なしの行は `⏰` ごと出さない（空欄を作らない）
- **期限超過**は `⚠️` に変える（`⚠️7/12(土) 期限超過`）
- 担当なしの行は `👤` ごと出さない

### 5-2. 期限リマインド（本仕様のスコープに含める）

**期限が意味を持つのはリマインドされたときだけ**なので、保存だけで終わらせない。
ただし **新しい cron は足さない**。digest は既に毎朝 open タスクを**全件**配信しているので、
リマインドの実体は「並び順」と「表示」で足りる。

- **配信直前の再採番を期限順にする**（`clearAndRenumberOpenDigestTasks`）:
  期限の近い順 → 期限なしは末尾。同着は `created_at` 順で安定させる。
  期限超過・当日のタスクが常に `1.` `2.` に来るため、**一覧の先頭がそのままリマインドになる**
- **超過は `⚠️`、当日は「今日」**と表示する（§5-1）
- 担当は `👤山田さん` とテキストで名指し（push メッセージにLINEのメンションは付けられない）
- グループ単位でまとめて1通（1タスク1通にしない。通知過多はミュートを招く）

時刻単位の即時リマインド（「17:00の30分前に鳴らす」）は**本仕様では作らない**。
そこまでやるなら専用 cron が要り、通知過多とミュートのリスクが上がる。
まず「期限が見える・超過が目立つ・期限順に並ぶ」で運用し、必要になってから足す。

---

## 6. identity バックフィル

`assignee_external_user_id` を残しておくと、**後から人単位の管理に昇格できる**。

- 新規 identity 作成時（link_code 消費時）に、
  同一 `org_id` × `channel='line'` × `external_id` を持つ **open な digest task** の
  `assignee_identity_id` を埋める
- 既存の「グループ紐付け時バックフィル」（`processGroupLinkCode` の `linkGroupToSpaceAtomic`）と同じ思想
- **過去の done タスクは触らない**（履歴を書き換えない）

---

## 7. 本体 `tasks` への昇格（本仕様の対象外・論点のみ）

やらない理由と、やるなら決めるべき論点:

- **`channel_identities` は社内メンバーではない**。`space_id` 必須の「顧問先の窓口」identity であり、
  `tasks.assignee_id`（`profiles`）とは別軸。**メンションで結べるのは「LINE上の人」であって「TaskAppのユーザー」ではない**
- `tasks` は ball / origin / deliverable の不変条件を持つ（ball='client' ⇒ deliverable 必須、着地は `resolveLanding` 一元化）。
  LLM 抽出をそのまま自動 INSERT すると不変条件を壊す
- よって自動昇格は取らず、**「digest に溜める → LINE上のボタン／コンソールで確認 → 本体タスク化」** の一段クッションが要る
- この判断は複数サブシステムに波及し後戻りが難しいため、**別途 `fable-architect` に委ねる**

---

## 8. 実装順（TDD・Red → Green → Refactor）

| # | 内容 | テスト |
|---|------|--------|
| 1 | `dueParse.ts`（日本語日時パーサ＋バリデーション） | 「明日」「金曜」「7/17」「17時まで」「今週中」「昨日」（→null）「来年」（→null）の表 |
| 2 | `events.ts` mentionee 正規化＋payload保存 | userId あり／なし／`type:'all'`／self のみ、の各ケース |
| 3 | migration（§2）＋ `store.ts` の書き込み | insert 後の列値・重複('duplicate')の冪等性 |
| 4 | `compute.ts` プロンプト拡張＋メンション優先マージ | LLM応答の壊れJSON・過去日・時刻のみ、の各 null 落ち |
| 5 | digest 表示・期限超過・リマインド | 期限なし行に `⏰` が出ないこと／超過が `⚠️` になること |

---

## 9. 未決（実装前に確定する）

1. **複数メンション時の担当** — 先頭1件を採用（本仕様の既定）。全員を hint に連結する案もある
2. **`due_time` の既定** — 明示がなければ null（終日）。「午前中」「朝イチ」を 12:00 等に丸めない
3. **リマインドの配信時刻** — 既存 digest 便に相乗りする前提。当日期限に間に合う便がない場合の扱い
