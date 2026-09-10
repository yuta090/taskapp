# GitHub Issues 連携 仕様書

> **Version**: 1.2（設計確定・未実装。1.1 で調査にもとづく追加: §4-14〜16・§7.2 の PR→Issue→タスク・§7.3 のタイトル・§9 PR1.5。1.2: Issue の書き換えと再計算を1回の RPC に（通知の取りこぼし防止）・紐づけのトリガー）
> **Last Updated**: 2026-09-11
> **Status**: 設計確定（Fable 裁定 2026-09-10・追加裁定込み）。実装は §9 の PR0a〜PR3 で順に行う
> **関連**: `spec/GITHUB_INTEGRATION_SPEC.md`（既存の PR 連携）／`spec/AGENCY_MODE_SPEC.md`（見せ分け表。本仕様に合わせて 2026-09-10 改訂）／`design/GITHUB_MILESTONE_INTEGRATION.md`（旧設計。本仕様で廃止。§12）

## 0. ひとことで

- GitHub Issues を AgentPM のタスクに**ぶら下げる（添付する）**。1件ずつコピーする「ミラー」ではない。
- **約束の正本は AgentPM、作業の正本は GitHub**。GitHub 側の出来事で AgentPM のタスク本体は書き換えない。
- 狙いは「**エンジニアは GitHub から出ない／お客さんは GitHub を見ない**」の両立。
- ぶら下げた Issue が全部閉じたら、**社内の担当者に「作業が全部終わりました」と知らせる**。お客さんにボールを渡すのは人（既存のボール渡し操作）。

## 1. 背景

- 既存の GitHub 連携は PR とタスクの紐づけだけで、Issues は扱っていない（App の許可も PR の読み取りのみ）。
- Jira / Backlog / Linear 等は取り込めるのに GitHub Issues は無く、Issues で回している開発会社は二重入力になる。
- 既存 GitHub App の土台（installation token・webhook・リポジトリ一覧・プロジェクト↔リポジトリ対応）に Issues を足す。使う人から見ると「設定が増える」のではなく「今の GitHub 連携でできることが増える」。

## 2. 範囲

### v1 でやる

- Issue の受信・保存（webhook）と、タスクへの紐づけ（入口は3つ）
- タスク詳細（Inspector）に、紐づいた Issue の一覧と「N 件中 M 件完了」を表示（社内のみ）
- AgentPM から Issue を作る（非公開リポジトリのみ・文面は人が確認してから送る）
- 全部閉じたら社内担当者へ確認通知＋取りこぼしを拾う照合 cron
- 土台の是正: 既存 GitHub 表の見せ分けの穴（§11）・webhook の重複排除・許可範囲の正本一本化

### v1 でやらない

- Issue や PR の状態でタスクの状態・ボール・期限を自動で変える（§12）
- お客さんへの自動ボール渡し
- コメントの同期
- 既存 Issues の一括取り込み（Issue→タスク化）
- お客さんポータルへの表示（件数も出さない）
- 制作会社（vendor）への表示・操作（v1 は社内メンバーのみ。§5）
- プランによる制限（§13-1 で確認）

## 3. 全体の流れ

```
お客さんの要望（AgentPM タスク）
   │ ① Inspector で「Issue を作る」（文面を人が確認してから送る）
   ▼
GitHub Issue（非公開リポジトリ）
   │ ② エンジニアは GitHub だけで作業（AI エージェントへの割り当ても可）
   │ ③ webhook（issues.closed 等）。取りこぼしは照合 cron が拾う
   ▼
AgentPM：ぶら下がった Issue の集計（open 件数）
   │ ④ open が「1以上 → 0」に、Issue が閉じたことで変わったら
   ▼
社内担当者へ通知「作業が全部終わりました（完了 N 件／見送り M 件）」
   │ ⑤ 人が既存のボール渡し操作で、お客さん（またはエージェンシー）へ渡す
   ▼
お客さん：「確認お願いします」（既存の ball_passed 通知）
```

紐づけは ① のほか、Issue のタイトル/本文に `TP-123` と書く（自動）、既存の Issue を選ぶ（手動）でもできる。PR は、タイトル・本文・ブランチ名の `TP-123` に加えて、**つながった Issue を経由して**も自動でタスクにつながる（§7.2。PR 本文の `Fixes #12`、Issue から作ったブランチ、GitHub 上での手動リンク）。

## 4. 設計判断（Fable 裁定 2026-09-10）

| # | 論点 | 決定 | 主な根拠 |
|---|---|---|---|
| 1 | 載せる場所 | 既存 GitHub App 側を拡張する（task-sync には載せない） | 認証・webhook・リポジトリ一覧・space↔repo が既にある。`connector_task_links` は「外部1件=タスク1件」のミラー前提で形が合わない。資格情報の二重管理を避ける |
| 2 | 関係の形 | タスク:Issue = 1:多の紐づけ。1つの Issue が複数タスクに紐づくのも許す。新しい表を作る | 子タスク化すると Issue がボール・期限リマインドの対象になり「エンジニアは GitHub から出ない」に反する。PR 表の一般化は既存 RLS・hooks に波及する |
| 3 | 書く方向と正本 | AgentPM→GitHub は作成時の1回だけ。GitHub→AgentPM はキャッシュ列だけ更新し、`tasks` 行は書かない | 約束の正本=AgentPM／作業の正本=GitHub。既存の「外部ツールが正本」規則は外部で生まれたタスク（`origin='external'`）向けで、今回は対象外（矛盾しない） |
| 4 | 全部閉じたら | 社内担当者へ通知し、既存のボール渡し UI へ誘導する。自動でお客さんへ渡す経路は作らない | `rpc_pass_ball` は人（`auth.uid()`）が必須で、client へ渡すには client owner も必須。人のいない経路からは構造的に呼べない。渡すと自動でお客さんに見える状態になり即時通知が飛ぶ＝取り消せない |
| 5 | 見せ分け | お客さんには何も出さない（件数も）。公開リポジトリへの作成は禁止（その場で GitHub に確認）。文面は人が見てから送る | 件数表示は「進捗の約束」を暗黙に生む。GitHub に書いた文面は AgentPM から消せない |
| 6 | App の許可範囲 | 最初から `issues: write`。許可範囲の正本を1ファイルにまとめる。「承認待ち」を UI に出す | 読み取り→書き込みの二段にすると導入先に2回承認させる。本番導入は現状自社の1件だけで影響が小さい |
| 7 | 冪等・取りこぼし | webhook の重複排除を先に直す。副作用は DB で single-winner（先着1回だけ実行）。Issue 作成は intent 行で二重作成を防ぐ。照合 cron は紐づき中の open Issue だけ | GitHub は失敗した配達を自動では再送しない。現状の webhook は同じ配達を二重に処理する |
| 8 | 紐づけの入口 | 作成・`TP-番号`で自動・手動の3つとも v1 | どれも安い。`task-linker.ts` を流用できる |
| 9 | 一括取り込み | v1 ではやらない | 紐づけで二重入力はほぼ解消する。取り込むと「Issue 1件＝約束1件ではない」大きさの違いが再燃する。要るなら `github_issues` から1件ずつ「タスクにする」が次の最小 |
| 10 | プラン | v1 はゲート無し（§13-1 で確認） | 課金裁定（2026-07-26）「ツール連携は別料金にしない」。既存の連携はどれも Free を弾いていない。絞るなら境界は Issue 作成と新規紐づけだけ（後から足せる） |
| 11 | PR 分割 | §9 の順で固定 | 土台（見せ分け・重複排除）を先に直さないと、新しい表が同じ穴を引き継ぐ |
| 12 | 制作会社（vendor）への見せ方 | v1 は github_* の全表を社内メンバーのみ。見せ分け表を「制作会社: 計画・未実装」に改める。vendor に Issue 作成・紐づけはさせない（将来も既定は否） | 読む画面が無いのに権限だけ開けるのは順序が逆。閉じておいて後で開けるのは安いが、逆は漏えい事故で取り消せない。Issue 作成は組織の GitHub App で外へ書く行為で、外部の人に持たせる権限ではない |
| 13 | 旧設計（PR マージで自動完了） | 廃止。不変条件 3〜5 は PR を含む GitHub 由来の処理すべてに適用する | 「PR マージ＝約束の完了」ではない。旧設計の目的は本仕様の 1:多紐づけ＋全閉じ検知＋社内確認で置き換えられる（§12） |
| 14 | Issue のタイトル（調査にもとづく追加） | AgentPM から作る Issue は、タイトルの先頭に `[TP-42] ` を付ける（本文にも番号と戻りリンク） | 見ればどのタスクか分かる。Issue 画面から作るブランチ（既定の名前は「Issue 番号＋タイトル」）や、Issue のタイトルを写した PR にも番号が乗りやすい |
| 15 | PR→Issue→タスクの自動紐づけ（調査にもとづく追加） | PR が Issue につながっていれば、その Issue に紐づくタスクにも PR を自動で紐づける（§7.2・PR1.5）。目印は PR 本文の閉じる言葉（**自前で読む**）と GraphQL の `closingIssuesReferences` | 「番号を PR に写す」決まりに頼ると、人や Copilot が忘れたら効かない。サーバーでたどれば、誰が作った PR にも効く。GitHub の閉じる言葉は既定ブランチ（このリポジトリでは main）宛ての PR にしか効かず、develop 宛てでは無視されるため、自前で読む |
| 16 | スキル化（調査にもとづく追加） | 新しいスキルは作らない。既存の agentpm スキル（`src/lib/cli-skill.ts` が manifest から生成し `/skills/agentpm/SKILL.md` で配る）に「PR に TP-番号を書く・番号の調べ方」の一節を足し、説明文に PR / GitHub の語を入れる | 効くのはスキルを入れた AI だけで、補助にとどまる。配る URL と更新の手間を増やさない |

## 5. データモデル

`tasks` には列を足さない。`connector_task_links` / `integration_connections` には触らない。

| 表 | 主要列 | 一意制約・トリガー | 書き手 |
|---|---|---|---|
| `github_installations`（既存・列追加） | `permissions jsonb`, `permissions_updated_at timestamptz` | — | callback / webhook（service role） |
| `github_issues`（新） | `id, org_id, github_repo_id → github_repositories (cascade), issue_number int, title, url, state check (open\|closed), state_reason text null, author_login, assignee_logins text[], issue_created_at, closed_at, github_updated_at, last_synced_at` | `unique (github_repo_id, issue_number)`／index `(org_id, state)` | service role のみ |
| `task_github_issue_links`（新） | `id, org_id, task_id → tasks (cascade), github_issue_id → github_issues (cascade), link_type check (auto\|manual\|created), created_by, created_at` | `unique (task_id, github_issue_id)`／org 一致トリガー（`check_task_pr_org_match` と同型） | 手動=space admin/editor（社内メンバー）、auto/created=service role |
| `task_github_issue_rollups`（新） | `task_id pk → tasks (cascade), org_id, open_count, completed_count, not_planned_count, all_closed_at timestamptz null, notified_at timestamptz null, updated_at` | 関数 `github_recompute_issue_rollup(p_task_id uuid)` だけが書く（戻り値は1行: `open_count_before, open_count_after, completed_count_after, not_planned_count_after, all_closed_at_after, became_all_closed`）。この関数を呼ぶのは、`github_apply_issue_state(...)`（Issue の upsert と、紐づく全タスクの再計算を1つの DB 取引で行う RPC。service role のみ。戻り値は紐づくタスクごとに1行＝`task_id`＋上の6列）と、紐づけの追加・削除のトリガー（`task_github_issue_links`・文ごと。戻り値は使わない）。複数タスクはどちらも task_id の順にロックする。紐づきが0件になったら行を消す | 上記関数のみ |
| `github_issue_create_intents`（新） | `id, org_id, task_id, github_repo_id, idempotency_key, status check (pending\|done\|failed), github_issue_id null, error, created_by, created_at` | `unique (idempotency_key)`／部分一意 `(task_id, github_repo_id) where status = 'pending'` | service role のみ |

### 読み取り権限（RLS）

`internal` ＝ `app_is_org_internal(org_id)`（owner / admin / member。client・vendor は含まない）。service role は RLS を通らないので表には書かない。

| 表 | 読む（select） | 追加（insert） | 更新（update） | 削除（delete） |
|---|---|---|---|---|
| `github_installations`（既存） | internal | org owner（既存どおり。セキュリティ修正では広げない） | 同左 | 同左 |
| `github_repositories`（既存） | internal | org owner（既存どおり。セキュリティ修正では広げない） | 同左 | 同左 |
| `space_github_repos`（既存） | internal かつ `app_is_space_member(space_id)` | internal かつ space admin/editor | 同左 | 同左 |
| `github_pull_requests`（既存） | internal | なし | なし | なし |
| `task_github_links`（既存） | internal かつ タスクの space の member | internal かつ space admin/editor | なし | 作成者 or space admin（internal に限る） |
| `github_issues`（新） | internal | なし | なし | なし |
| `task_github_issue_links`（新） | internal かつ space member | internal かつ space admin/editor（`link_type='manual'` のときだけ） | なし | 作成者 or space admin（internal に限る） |
| `task_github_issue_rollups`（新） | internal かつ space member | なし | なし | なし |
| `github_issue_create_intents`（新） | internal かつ space member | なし（API/RPC が service role で書く） | なし | なし |

- 既存のポリシーで `org_memberships` / `space_memberships` を直接引いている箇所は、すべて `app_is_org_internal(org_id)` を AND で足す形に統一する（client / vendor の除外をこの一点で決める）。
- **vendor に Issue 作成・紐づけはさせない**（v1 も将来も既定は否）。
- 新しい表（`task_github_issue_links` など）の組織一致トリガーは、**行の `org_id` もタスク・Issue の `org_id` と照合し、参照は SECURITY DEFINER で行う**（呼び出した人の見える範囲に頼らない）。既存の `check_task_pr_org_match` は行の `org_id` を見ておらず、呼び出した人の権限で読むことで結果的に守られている（PR0a の検証で確認）。
- 将来 vendor に読ませる場合（読む画面と同時に設計する。今は作らない）: タスク単位の表は `exists (select 1 from tasks t where t.id = task_id and app_task_visible_to_caller(t.space_id, t.org_id, t.client_scope, t.ball))`、`github_issues` / `github_pull_requests` はそのリンク経由のときだけ、`github_repositories` / `space_github_repos` は vendor に出さない。
- 見せ分け表の改訂（2026-09-10）: `AGENCY_MODE_SPEC.md` §1.4「技術仕様・GitHubリンク」の制作会社を △（計画・未実装）に、§3.2「GitHub PR リンク」を（将来）に改めた。代理店は組織オーナー＝社内メンバーなので ○ のまま整合する。
- 裏取り: ベンダーポータル（`src/app/vendor-portal/`）に GitHub の表示は無い。`TaskPRList` を使うのは社内の `TaskInspector` と設定画面だけ。

## 6. 構造で守る不変条件

1. **見せ分け**: github_* の表は社内メンバー（`app_is_org_internal`）だけが読める。client ロール・vendor ロール・ポータルの合鍵経路からは読めない（§5）。Issue の内容をお客さん向けの通知型に載せない（テストで通知型を固定）。
2. **公開リポジトリ**: Issue 作成はその場で GitHub に問い合わせ、`private=false` なら拒否する。DB の `is_private` は信じない。
3. **正本**: GitHub 由来の処理（webhook handler・照合 cron。**Issues に限らず PR も含む**）は `tasks` 行を UPDATE しない。`due_authority_connection_id` も設定しない。handler と cron のテストで `tasks` への書き込みゼロを固定する。
4. **二重実行**: webhook は delivery_id が重複したら処理しない。通知は rollup の条件付き UPDATE の勝者だけが作る。Issue 作成は intent 行の一意制約を先に取る。
5. **人が渡す**: ボールを client へ動かす経路は既存の `rpc_pass_ball`（`auth.uid()` 必須）だけ。GitHub 由来の処理（PR を含む）から、service role でボールを動かすコードを書かない。

## 7. 振る舞いの詳細

### 7.1 webhook 受信

- 購読するイベント: `pull_request`, `issues`（installation 系は App に常に届く）
- `issues` で扱う action: opened / edited / closed / reopened / deleted / transferred / assigned / unassigned
- 流れ: 署名検証 → `github_webhook_events` に insert（delivery_id 重複＝`23505` なら処理せず 200 を返す）→ handler → 成功時だけ `processed=true`、失敗時は `processed=false`＋`error_message`（後で拾い直せるようにする）
- `github_apply_issue_state` で、Issue の upsert（`unique (github_repo_id, issue_number)` で冪等）と、その Issue に紐づく全タスクの rollup 再計算を1回（1つの DB 取引）で行う。通知は、戻り値の `became_all_closed` と原因（`closed` イベントか）で判定する（通知は PR3）
- 届く順番の入れ替わり: 引数の `github_updated_at` が保存済みより古い（厳密に小さい）通知は、Issue の行を書き換えず、再計算もしない（戻り値は紐づくタスクごとに件数は変化なし・`became_all_closed=false`）。同じ時刻なら書き換える（同じ時刻に複数の action が来るため）。どちらかが null なら比べずに書き換える
- 対象は `github_repositories` にあるリポジトリだけ。GitHub の Issues API は PR も Issue として返すので、`pull_request` キーを持つものは除外する
- 転送（`transferred`）: 転送先が同じ org の `github_repositories` にあれば repo・番号・URL を書き換える（件数は変わらないので再計算は要らない）。無ければ削除扱い（下の削除と同じ。通知しない）
- 削除（`deleted`）: 行を削除（link は cascade で消え、紐づけのトリガーが rollup を再計算する。通知しない）

### 7.2 紐づけの入口

**Issue とタスク**（`task_github_issue_links`）

| 入口 | link_type | 条件 |
|---|---|---|
| AgentPM から作成 | `created` | §7.3 |
| Issue のタイトル/本文に `TP-123` | `auto` | `issues.opened` / `edited` で `extractTaskIds` を流用。そのタスクの space がリポジトリと紐づいているときだけ（既存の PR と同じ規則） |
| 手動で選ぶ | `manual` | 同じ space に紐づくリポジトリの Issue を番号/タイトルで検索。space editor 以上の社内メンバーのみ |

- 解除: 紐づけを作った本人か space admin（社内メンバーに限る。§5 の RLS）。解除すると紐づけのトリガーが rollup を再計算する（通知しない）。

**PR とタスク**（既存の `task_github_links`）

| 入口 | 条件 |
|---|---|
| PR のタイトル・本文・ブランチ名に `TP-123` | 既存の `task-linker`。番号の拾い方は「直前が英数字でない＋`TP-`＋数字、直後は数字でない、大文字小文字を区別しない」。日本語が直後に続く（`TP-42の修正`）・読点・全角かっこ・ブランチ名（`feat/tp-42-login`）も拾い、`HTTP-001` は拾わない（番号表示の PR で是正） |
| **PR がつながった Issue を経由（PR1.5）** | PR の opened / edited / synchronize / closed のたびに、つながった Issue を次の2つで調べる。① PR 本文の閉じる言葉（close / closes / closed / fix / fixes / fixed / resolve / resolves / resolved ＋ `#n` または `owner/repo#n`）を**自前で読む**（宛て先ブランチに関係なく効かせるため）。② GraphQL の `PullRequest.closingIssuesReferences`（Issue 画面から作ったブランチ・Development 欄の手動リンク。GitHub がつなぐのは既定ブランチ宛ての PR だけ）。見つかった Issue が `github_issues` にあってタスクに紐づいていれば、そのタスクへ PR を `auto` で紐づける（`unique (task_id, github_pr_id)` で重複しない） |
| 手動（既存） | タスクの「関連PR」→「PRを紐付け」 |

- 閉じる言葉の付かない `#12`（ついでに名前を出しただけ）は拾わない。
- 経由でつないだ PR も、取り込まれたら既存の社内通知（`github_pr_merged`）の対象になる。タスク行は更新しない（§6-3）。
- 補助（v1 では作らない）: Issue が閉じたとき、GitHub の履歴（GraphQL の `ClosedEvent.closer` / REST の issue events）から閉じた PR を拾ってつなぐ。照合 cron に相乗りできる。

### 7.3 Issue 作成（AgentPM → GitHub）

1. Inspector の作成欄でリポジトリを選び、あらかじめ入っているタイトル/本文を**人が確認・編集**して「作成」を押す
2. サーバーが `github_issue_create_intents` に insert（`idempotency_key` はクライアントが生成）。一意違反なら既存の結果を返す
3. installation token で `GET /repos/{owner}/{repo}` を呼んでその場で確認し、`private=false` なら拒否（結果で `github_repositories.is_private` も更新）
4. `github_installations.permissions.issues` が `write` でなければ拒否し、承認の案内を返す
5. Issue を作成 → `github_issues` を upsert → link（`created`）→ intent を `done` にする
6. あとから `issues.opened` の webhook が来ても同じ行に upsert される。本文の `TP-番号` による自動紐づけも `unique (task_id, github_issue_id)` で重複しない

- **あらかじめ入れる文面の規則**: タイトル＝`[TP-42] `＋タスクのタイトル（§4-14）。本文＝タスクの説明＋AgentPM への戻りリンク＋`TP-番号`＋「対応する PR の本文には、この Issue を閉じる言葉（例: `Closes #番号`）を書いてください」の一文（PR→Issue→タスクの自動紐づけの目印になる。§7.2）。**お客さんの名前・会社名・連絡先や、LINE などの元メッセージの引用は自動で入れない**（文面を作る関数の単体テストで固定）。
- 作成は外への書き込みで取り消せないので、楽観更新はしない（送信中の表示 → 結果を反映）。

### 7.4 全部閉じたときの判定と通知

- 集計（rollup）はタスクごと: open / completed / not_planned の件数
- **通知する条件**（すべてを満たすとき）:
  - open 件数が **1以上 → 0** に変わった
  - 変わった原因が **Issue のクローズ**（`issues.closed`、または照合 cron が閉じたことを検知）
  - その再計算の呼び出しで `became_all_closed` が true になった（紐づけ・解除のトリガー経由の再計算では通知しない）
- **通知しない**: 紐づけの解除・Issue の削除・転送で対象外になった・既に閉じている Issue を後から紐づけて 0 になった（表示だけ更新する）
- `state_reason='not_planned'`（見送り）も「閉じた」に含めるが、本文に「完了 N 件／見送り M 件」を必ず出す（人が判断する）
- 再オープンで open>0 に戻ったら `all_closed_at` を NULL に戻す。もう一度全部閉じたら再通知する
- single-winner: `update … set notified_at = now() where task_id = $1 and all_closed_at is not null and (notified_at is null or notified_at < all_closed_at) returning …` の勝者だけが通知を作る
- PR3 向け: 部分解除（閉じた Issue が残る形で open の Issue だけ外す）でも `all_closed_at` は入るので、`notified_at` の条件だけで通知を判定しない（上の `became_all_closed` と原因の両方を必須にする）
- 一部だけ閉じた: 表示だけ更新する
- `client_scope='internal'` のタスクでも通知は出す（渡すかどうかは人が決める。既存 UI が「お客さんに見えるようになります」の警告を出す）
- **宛先**: `task_owners (side='internal')` → いなければ紐づけ/作成した人（`created_by`）→ いなければ `spaces.default_reviewer_ids`
- **通知の種類**: 社内向けの新しい型（例 `github_work_done`）。お客さん向けの型には載せない。配信は push を即時、メールは社内の既定バッチ
- **通知から開く先**: タスク Inspector の既存のボール渡し操作。渡す相手（client / agency / vendor）はそこで人が選ぶ。エージェンシーモードの vendor→agency もこの型に乗る

### 7.5 照合 cron（取りこぼし対策）

- 1時間ごと。対象は「紐づきがあり、かつ `state='open'`」の `github_issues` だけ。1回あたりの件数に上限を置く
- 対象の番号を個別に GET し、閉じていれば `github_apply_issue_state` で書き換えと再計算を1回で行う。戻り値の `became_all_closed` が true のタスクへ、webhook と同じ経路で通知する（原因は「閉じたことの検知」）
- 既存 cron の呼び出し方式（vault secret・`app_invoke_*`）に合わせる

### 7.6 許可範囲と承認待ち

- 確定値: permissions `{ pull_requests: read, issues: write, metadata: read }`／events `['pull_request', 'issues']`
- 正本は `src/lib/github/permissions.ts`（crypto を含まない純データ）。`config.ts` と `scripts/setup-github-app.mjs` の両方がここから読む。一致をテストで固定する
- `config.ts` にある `contents:read` は使用箇所が無い（2026-09-10 に grep で確認）ので落とす
- `installation.new_permissions_accepted` を処理して `github_installations.permissions` を更新する。インストール時の callback でも保存する
- Issue 作成ボタンは `issues='write'` が無ければ無効にして、GitHub の承認ページへ案内する（紐づけ・表示は `issues` の読み取りがあれば動く）

## 8. 画面

- タスク Inspector の GitHub セクション（既存の PR 一覧の下）に「Issues」を足す
  - 紐づいた Issue の一覧（番号・タイトル・状態・担当 login・GitHub で開く）
  - 「N 件中 M 件完了」のバッジ（社内のみ。お客さんに見える印の Amber は付けない）
  - 「Issue を紐づける」: 番号/タイトルで検索して選ぶ（楽観更新）
  - 「Issue を作る」: リポジトリ選択＋タイトル/本文の編集欄＋作成ボタン（Inspector 内のセクション。モーダルにしない）
  - 許可が足りないときは、作成欄の代わりに承認の案内を出す
- 通知 Inspector: `github_work_done` のアクションパネルから、タスクのボール渡しへ移る
- お客さんポータル・ベンダーポータル: 何も出さない（v1）

## 9. PR 分割と受け入れ条件

- 順序は固定。PR0a と PR0b は互いに独立（順不同）で、PR1 は両方がマージされた `develop` を起点にする。
- ブランチ名は作成時に一意性を確かめ、必要なら時刻を付ける。migration 名は `YYYYMMDDHHMMSS_<topic>.sql`。
- Inspector や hooks を触る PR（PR1・PR2）は、出す前に `page-perf-reviewer` を通す。画面の表示名・`data-testid` を変えたら E2E をローカルで1回回す。

### PR0a `security/rls-github-internal-only`（既存の穴をふさぐ）

- 既存5表（`github_installations` / `github_repositories` / `space_github_repos` / `github_pull_requests` / `task_github_links`）の RLS を §5 の表に置き換える
- テスト: **client ロール・vendor ロールの両方で**、全 github_* 表が 0 行になる（vendor は今は `space_memberships` 経由で見えている）／社内メンバーは従来どおり読める・紐づけられる

### PR0b `fix/github-webhook-dedupe-permissions`（土台・挙動はほぼ変わらない）

- delivery_id が重複したら処理せず 200。`processed=true` は成功時だけ
- `permissions.ts` を正本にし、マニフェストと config の一致をテストで固定。`new_permissions_accepted` で `permissions` を保存
- テスト: 同じ delivery を2回送っても handler は1回だけ呼ばれる／失敗時は `processed=false`

### PR1 `feat/github-issues-link`（受信・保存・紐づけ・表示）

- `issues` webhook → `github_apply_issue_state`（Issue の upsert と、紐づくタスクの rollup 再計算を1回で）。通知の判定（`became_all_closed` かつ `closed` 由来）と発火は PR3。紐づけの追加・解除では DB のトリガーが再計算する
- `TP-番号` の自動紐づけ・手動の紐づけ/解除・Inspector の Issue 一覧＋バッジ
- テスト: upsert が冪等／PR を含む一覧から `pull_request` キー付きを除外／TP 抽出は space↔repo が紐づくときだけ／解除で rollup が更新される／client・vendor ロールから見えない／`tasks` が更新されない

### PR1.5 `feat/github-pr-issue-link`（PR→Issue→タスクの自動紐づけ）

- §7.2「PR がつながった Issue を経由」を実装する。PR の opened / edited / synchronize / closed で、本文の閉じる言葉を自前で読み、GraphQL の `closingIssuesReferences` も1回引く（失敗しても PR の受信・既存の紐づけ・通知は止めない）
- 見つかった Issue に紐づくタスクへ、PR を `auto` で紐づける（既存の `task_github_links`・重複しない）
- テスト: `Fixes #12`／`closes owner/repo#12` を拾う・閉じる言葉の無い `#12` は拾わない／develop 宛ての PR でも本文の閉じる言葉で紐づく／GraphQL の結果（Issue から作ったブランチ・手動リンク）で紐づく／`github_issues` に無い Issue・どのタスクにも紐づかない Issue では何もしない／`tasks` が更新されない／GraphQL が失敗しても webhook は成功する
- 前提: PR1（`github_issues` と `task_github_issue_links`）がマージ済み。GraphQL で `closingIssuesReferences` を読むのに要る App の許可は、実装時に実機で確かめる（計画中の `pull_requests: read`＋`issues: write` で足りる見込み・未確認）

### PR2 `feat/github-issue-create`（AgentPM → GitHub）

- Inspector の作成欄。intent 行 → その場で非公開か確認 → 作成 → `github_issues`＋link（`created`）。許可が足りなければ無効化＋承認案内
- テスト: 二重送信しても GitHub への作成呼び出しは1回／公開リポジトリは拒否／本文にお客さんの名前・元メッセージが入らない（文面生成関数の単体テスト）／`issues` 許可が無いと 4xx／作成後の `opened` webhook が重複行を作らない
- 前提: §10 の手作業を先に済ませる

### PR3 `feat/github-issues-all-closed`（確認通知＋照合 cron）

- rollup の single-winner で社内通知（`github_work_done`）を作る。通知 Inspector からボール渡しへ誘導。宛先は §7.4 の順で決める
- 照合 cron（紐づき中の open だけ・件数上限つき・vault secret）
- テスト: open>0→0 で通知が1件・並行して2回走っても1件／解除・削除・閉じた Issue の後付けでは通知しない／再オープン→再クローズで再通知／見送りの内訳が文面に出る／service role がボールを動かさない／cron が閉じたことを拾って同じ経路で通知する

## 10. 手作業（運用）

1. PR2 のデプロイ前に、GitHub の App 設定（AgentPM for GitHub）で許可に Issues（読み書き）を、イベントに `issues` を追加する
2. 自社のインストールで新しい許可を承認する
3. 他の導入先には GitHub から承認依頼が届く。承認されるまで、その導入先では Issue 作成が無効と表示される

## 11. 既存の穴（本仕様で是正する）

- 既存 github_* 表の読み取り権限が「組織のメンバーなら誰でも」になっている（`org_memberships` の全ロール＝お客さんロールを含む）。`task_github_links` と `space_github_repos` は「プロジェクトのメンバーなら誰でも」（client / vendor ロールを含む）。
- 影響: お客さん用アカウントでログインした人が、API 経由で組織内のリポジトリ名・PR の題名・ブランチ名を読める（**別のお客さんのプロジェクト分も**）。制作会社（vendor）ロールの人も、自分が入っているプロジェクトの紐づけを読める。お客さんポータル（合鍵リンク）経由では出ていない。本番の確認（2026-09-10）: GitHub を導入している組織は1つで、そこに社外ロール（client / vendor）のユーザーは0人だった＝現時点で実際に読めた人はいない。
- 見せ分け表（`AGENCY_MODE_SPEC.md` §1.4 の「技術仕様・GitHubリンク: エンドクライアント ×」）とも矛盾している。
- この型のまま Issues の表を作ると Issue の本文まで漏れるため、PR0a で先に直す。

## 12. 旧設計との関係

- `docs/design/GITHUB_MILESTONE_INTEGRATION.md`（2024-02-08・承認済み・未実装）は本仕様で **廃止（superseded）** とする。
- 旧設計は (i) PR マージでタスクを自動 done、(ii) マイルストーン内の全タスクが done になったらお客さんへ自動通知、(iii) `spaces.github_auto_complete` / `milestone_notify_on_complete` の追加、を定めていた。いずれも本仕様の不変条件（GitHub 由来の処理は `tasks` 行を更新しない／お客さんへボールを渡すのは人だけ）に反する。
- 「PR マージ＝約束の完了」ではない（デプロイ・動作確認・お客さんの確認が残る）。自動 done は「完了」の意味を GitHub に明け渡し、正本の分割（約束＝AgentPM／作業＝GitHub）を壊す。旧設計は `ball⟹client_scope` の不変条件・期限リマインドの確認ループ・承認通知 cron より前に書かれており、その後に積んだ「人が確認してから外へ出す」型とも整合しない。
- 旧設計の目的「作業が全部終わったらお客さんに確認を回す」は、タスク:Issue=1:多の紐づけ＋全閉じ検知＋社内担当者への確認通知（§7.4）で置き換える。マイルストーンという括りは、タスク（約束）そのものが括りなので要らない。
- 将来「PR マージで完了を提案する」機能を足す場合も、社内担当者への提案通知＋人の1タップに限り、自動更新・自動通知は行わない。旧設計の列 (iii) は追加しない。
- 旧ファイルは冒頭のステータスを「廃止」に書き換え、本文は履歴として残す（削除しない）。`SPEC_INDEX.md` の Phase 3 も「廃止」に改めた。
- PR が取り込まれたときの社内通知（知らせるだけ・タスクは変えない）は実装済み（`GITHUB_INTEGRATION_SPEC.md` 参照）。

## 13. ユーザー確認

1. Free プランでも使えるようにするか（既定＝ゲート無し。絞るなら Issue 作成と新規紐づけだけを Pro にする）
2. お客さんポータルに「作業 N 件中 M 件完了」を出すか（既定＝出さない。出すなら見せ分け表の改訂が先）

## 付録: 裏取りした事実（2026-09-10）

- `rpc_pass_ball` は `auth.uid()` が NULL なら例外。`ball='client'` には client owner が必須。client に渡すと `client_scope` を自動で `deliverable` にする（`supabase/migrations/20260706003903_ball_client_scope_invariant.sql`）
- `ball_passed` は即時配信（`src/lib/notifications/delivery.ts`）
- webhook は `github_webhook_events` への insert の失敗を見ずに処理を続け、成功・失敗どちらでも `processed=true` にする（`src/app/api/github/webhook/route.ts`）
- マニフェスト（`scripts/setup-github-app.mjs`）の許可は `{ pull_requests: read, metadata: read }`、イベントは `['pull_request']`。`config.ts` は `contents:read` も並べているが使用箇所は無い
- RLS の補助関数 `app_is_org_internal`（owner/admin/member）・`app_is_space_member(p_space)`・`app_is_space_vendor(p_space)`・`app_task_visible_to_caller(p_space, p_org, p_client_scope, p_ball)`・`app_is_org_owner_or_admin(p_org)` が既にある（`20260703_001_rls_helpers.sql` / `20260703_010_rls_vendor_task_scope.sql` / `20260721215120_org_due_reminders_toggle.sql`）
- `space_memberships.role` は admin / editor / viewer / client / vendor（`20260308_000_agency_mode_foundation.sql`）
- ベンダーポータル（`src/app/vendor-portal/`）に GitHub の表示は無い
- GitHub Issues には期限の欄が無い。状態は open / closed＋`state_reason`。REST の issues 一覧は PR も含む。App の許可を広げても、導入先が承認するまでは旧い許可のまま動く

**調査で確かめた GitHub の動き（§4-14〜16・§7.2 の根拠）**
- 閉じる言葉（close / closes / closed / fix / fixes / fixed / resolve / resolves / resolved）は、**既定ブランチ宛ての PR でしか読まれず**、ほかの宛て先では無視されリンクも作られない（https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue ）。このリポジトリの既定ブランチは main で、ふだんの PR は develop 宛て
- `pull_request` の webhook には「この PR が閉じる Issue」は入らない。取るには GraphQL の `PullRequest.closingIssuesReferences`（https://docs.github.com/en/graphql/reference/pulls ）
- Issue 画面の「Create a branch」で作ったブランチは Issue とつながり、名前の既定は「Issue 番号＋タイトル」（GraphQL `createLinkedBranch` の説明。https://docs.github.com/en/graphql/reference/issues ）。正確な形は未確認
- Copilot coding agent に Issue を割り当てると PR を開くが、ブランチ名は `copilot/…` の形で Issue 番号は入らない（https://github.blog/changelog/2025-10-16-copilot-coding-agent-uses-better-branch-names-and-pull-request-titles/ ）。PR 本文に `Fixes #n` が入るかは未確認
- Issue を閉じた PR は webhook には入らず、GraphQL の `ClosedEvent.closer` や REST の issue events の `commit_id` で分かる（https://docs.github.com/en/rest/using-the-rest-api/issue-event-types ）
- agentpm スキルは `src/lib/cli-skill.ts` が manifest から組み立て、`/skills/agentpm/SKILL.md`（`src/app/skills/agentpm/SKILL.md/route.ts`）で配る。利用者の手元にあるのは写しなので、更新には取り直しが要る
