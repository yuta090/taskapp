# 会員登録後の節目（ファネル）と流入経路 — 運営分析 v1.0

- 作成日: 2026-09-07
- 画面: `/admin/analytics`（ファネル・流入経路別・全節目）、`/admin/organizations/[id]`（組織ごとの節目タイムライン・流入経路の手動登録）
- DB: `supabase/migrations/20260907065023_org_milestones_acquisition.sql`
- コード: `src/lib/analytics/milestones.ts`（節目カタログ・集計）、`src/lib/acquisition/firstTouch.ts`（流入経路の判定）

## 何のためか

「登録はされるが、その先どこで止まっているか」「どの経路から来た人が定着・有料化するか」を運営が数字で見るため。
広告・記事・営業のどこに力を入れるかを決める材料にする。

## 方針（設計判断）

| 論点 | 決定 | 理由 |
|---|---|---|
| 節目の記録方法 | **既存データから導出**（SQL の照合関数 `reconcile_org_milestones()`）。アプリの導線には原則手を入れない | 既存の組織にも遡って効く。書き忘れが起きない。導線の変更で壊れない |
| 例外 | 元データに時刻が残らない節目（相手先画面のプレビュー）だけアプリから `rpc_record_org_milestone()` で直接記録（ホワイトリスト） | プレビュー閲覧はフラグ（真偽値）しか無く時刻が取れない |
| 単位 | **組織**（org）単位。1組織×1節目=1行、到達時刻は元データの時刻 | 顧客の単位が組織。ユーザー単位だと招待メンバーで水増しされる |
| 集計の鮮度 | 毎時 cron（`org-milestones-reconcile`）＋運営画面の「いま再集計する」ボタン | ページ表示のたびに照合すると重い。1時間遅れで十分 |
| 流入経路の記録 | 門番（`src/proxy.ts`）が **first-touch cookie**（`agentpm_ft`・90日）を置き、組織作成時に `rpc_record_org_acquisition()` で `org_acquisition` に1行記録 | 静的LP・Google ログイン経由でも取れる。最初の訪問を守る（上書きしない） |
| 手動登録 | 運営が組織詳細ページで流入経路（営業・イベント等）とメモを登録できる（`channel_source='manual'`）。自動判定は「行があれば何もしない」ので手動を潰さない | 営業・紹介はオンラインの手がかりが無い |
| 既存の記事計測 | `/signup` の `?ref=task6&art=<slug>` → user metadata はそのまま残す。組織作成時の補完にも使う | 記事別の集計（`docs/blog/MEASUREMENT_DESIGN.md`）は今まで通り取れる |
| アクセス制御 | 両テーブルとも RLS 有効・policy 無し（service role のみ）。運営画面は admin client、書き込みは RPC（本人確認あり）と運営 API（superadmin 確認あり） | 分析データを一般ユーザーに見せない |

## 節目カタログ（22個）

キーは DB の CHECK 制約・`reconcile_org_milestones()`・`src/lib/analytics/milestones.ts` の3か所で一致させる。

| 分類 | キー | 意味 | 判定元 |
|---|---|---|---|
| 初期設定 | `org_created` | 組織を作成 | organizations.created_at |
| 初期設定 | `project_created` | 最初のプロジェクト（初期設定完了） | spaces(type=project) の最初 |
| 初期設定 | `first_task` | 最初のタスク（サンプル以外） | tasks(is_sample=false) の最初 |
| 定着 | `tasks_10` | タスク10件到達 | 10件目の tasks.created_at |
| チーム | `team_invited` | チームメンバーを招待 | invites(role=member) or 2人目の内部メンバー参加 |
| 相手先 | `client_invited` | 相手先を招待 | invites(role=client) or client の参加 |
| チーム | `anyone_invited` | 誰かを招待（上2つの早い方） | 導出 |
| 相手先 | `task_published` | タスクを相手先に公開 | tasks(client_scope=deliverable) ※作成/更新で近似 |
| 相手先 | `portal_previewed` | 相手先の画面をプレビュー | **アプリから記録**（`PortalPreviewSeenMarker`） |
| 秘書 | `line_requested` | 共通LINE申込 | org_channel_policy.shared_bot_access_requested_at |
| 秘書 | `line_granted` | 共通LINE開通 | org_channel_policy.shared_bot_access_granted_at |
| 秘書 | `line_linked` | LINE秘書と本人が連携 | channel_user_links の最初 |
| 秘書 | `chat_group_connected` | チャットのグループ接続 | channel_groups.joined_at の最初 |
| 秘書 | `ai_configured` | AI連携を設定 | org_ai_config |
| 秘書 | `first_ai_task` | AIが最初のタスクを拾った | channel_digest_tasks の最初 |
| 連携 | `tool_connected` | ツール連携 | integration_connections の最初 |
| 連携 | `api_key_created` | APIキー発行 | api_keys の最初 |
| 定着 | `retained_7d` | 7日後も利用 | 作成+7日以降のタスク作成/更新の最初 |
| 定着 | `retained_30d` | 30日後も利用 | 作成+30日以降のタスク作成/更新の最初 |
| 課金 | `quote_requested` | 見積もり依頼 | billing_quotes.requested_at |
| 課金 | `paid` | 有料化 | org_billing(plan≠free & active/trialing).updated_at or 見積もり承認 |
| 課金 | `canceled` | 解約 | org_billing(status=canceled).updated_at |

**メインファネル**（`FUNNEL_STEPS`）: 組織作成 → 最初のプロジェクト → 最初のタスク → 誰かを招待 → 7日後も利用 → 有料化。
LINE を使わない組織も落ちないよう、チャネル依存の節目は背骨に入れない。

## 流入経路（channel）

| キー | 表示 | 自動判定 | 手動登録 |
|---|---|---|---|
| `task6_article` | 記事（TASK6） | `ref=task6` | ○ |
| `shindan` | タスク滞留診断 | `ref=shindan` | ○ |
| `organic_search` | 検索 | 参照元が Google/Bing/Yahoo 等、または `utm_medium=organic` | ○ |
| `ai_search` | AI検索（ChatGPT 等） | 参照元が chatgpt.com / perplexity.ai / gemini 等 | ○ |
| `paid_ad` | 広告 | gclid 等のクリックID、または `utm_medium` が cpc/ppc/paid 系 | ○ |
| `sns` | SNS | `utm_medium=social` / `utm_source` が SNS 名 / 参照元が SNS | ○ |
| `referral` | 紹介・他サイト | `utm_medium=referral` / 参照元がその他の外部サイト | ○ |
| `email` | メール | `utm_medium=email` | ○ |
| `sales` | 営業・直接の紹介 | — | ○ |
| `event` | セミナー・イベント | — | ○ |
| `direct` | 直接 | cookie 無し（手がかり無し） | ○ |
| `other` | その他 | utm はあるが分類できない | ○ |
| `unknown` | 不明 | 記録開始前の組織で metadata も無い（backfill） | × |

判定順: 記事/診断 → 広告 → メール → SNS → 紹介(utm) → 検索 → AI検索 → SNS(参照元) → 紹介(参照元) → direct。

### cookie に残す情報（`agentpm_ft`）

`utm_source/medium/campaign/content/term`・`ref`/`art`・クリックIDの**種類だけ**（値は保存しない）・参照元の**ホスト名だけ**・最初に開いたパス・時刻。
個人を特定する情報は持たない。httpOnly ではない（組織作成時にクライアントが読む）。

## 運用

- **本番適用**: `scripts/apply-migration.sh` でマイグレーションを当てる（既存組織の節目と流入経路の backfill を含む）。pg_cron があれば `org-milestones-reconcile`（毎時7分）が自動登録される。
- **節目を増やすとき**: migration で CHECK 制約と `reconcile_org_milestones()` を拡張 → `MILESTONE_CATALOG` にラベルを追加 → テスト（`src/__tests__/lib/analytics/milestones.test.ts` の個数）を更新。
- **広告を出すとき**: LP の URL に `utm_source` / `utm_medium=cpc` / `utm_campaign` を付ける。それだけで流入経路別の到達率が出る。

## API

| Method | Path | 用途 |
|---|---|---|
| PATCH | `/api/admin/organizations/[id]/acquisition` | 流入経路の手動登録 `{ channel, note? }`（superadmin のみ） |
| POST | `/api/admin/milestones/reconcile` | 節目の再集計 `{ orgId? }`（superadmin のみ） |
| RPC | `rpc_record_org_acquisition(p_org_id, p_data)` | 組織作成時の自動記録（オーナー本人のみ・既存行があれば何もしない） |
| RPC | `rpc_record_org_milestone(p_org_id, p_milestone)` | アプリからの直接記録（内部メンバーのみ・ホワイトリスト） |
| RPC | `admin_org_milestone_stats(p_since)` | 集計（service role のみ） |
| RPC | `reconcile_org_milestones(p_org_id)` | 照合（service role / cron） |

## 既知の近似・制約

- `task_published` の時刻は公開操作ではなくタスクの作成/更新時刻で近似。
- `paid` / `canceled` の時刻は `org_billing.updated_at` で近似（初回観測が残る）。
- 記録開始前に登録した組織の流入経路は、メール登録時の `signup_ref` があれば記事/診断、無ければ `unknown`。
- first-touch cookie は 90 日。cookie を消したブラウザ・別端末での登録は `direct` になる。
