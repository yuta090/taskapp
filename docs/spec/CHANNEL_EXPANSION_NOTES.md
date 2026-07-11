# マルチチャネル展開 内部資料（Slack / Chatwork / Google Chat / メール）

LINE以外のチャネルにAI秘書（受信ログ・秘書名義送信・グループdigest・消し込み）を展開するための
**実装可能条件・API要点・作業手順**の内部資料。設計の正本は `docs/spec/AI_SECRETARY_STAGE2_DESIGN.md` §10、
運営者の作業チェックリストは `docs/CHANNEL_SETUP_TASKS.md`。本書は「実装に入る前に知っておくべき制約と手順」を残す。

> 「要確認」印は執筆時点で仕様変更の可能性がある外部仕様。**実装着手時に必ず公式ドキュメントで再確認**する。

---

## 0. 共通レイヤ（どのチャネルでも最初にやること）

### 0-1. スキーマはチャネル非依存（対応済み）

`channel_accounts` / `channel_identities` / `channel_messages` / `channel_groups` / `channel_digest_tasks` は
すべて `channel` 列を持ち、LINE固有カラムは `line_bot_user_id` のみ。**DDL変更なしで第2チャネルを追加できる**
（チャネル固有IDが必要になったら credentials_encrypted 内のJSONか、nullable列追加で対応）。

### 0-2. ChannelAdapter の抽出（未実装・第2チャネルPRの最初のタスク）

現状 `src/lib/channels/line/` にLINE固有処理が直書きされている。第2チャネル着手時に、まず以下を
インターフェースとして抽出するリファクタPRを独立で切る（設計 §10 のシグネチャ）:

```
verifyWebhook(raw, headers) / normalizeEvents(raw) / sendText(target, text)
/ sendDigest(target, items) / fetchAttachment(ref)
```

- `webhookHandler.ts` のフロー（アカウント逆引き→署名検証→dedupe→記録→分岐）はチャネル共通ロジックとして残し、
  チャネル差分だけを adapter に押し出す。
- digest計算（`digest/compute.ts`）・タスク消し込み・水位管理はすでにチャネル非依存。**変えるのは描画と送信だけ**。

### 0-3. チャネル横断の不変条件（全チャネルで維持）

- 受信は必ず `channel_messages` に証跡先行で記録（bot無効中も記録、能動的送信のみ停止）
- 添付は受信時に Storage 保存（各チャネルのメディアURLは短命）
- 外部イベントIDで dedupe（再送・リトライは全チャネルにある）
- グループ帰属に identity 由来の自動判定を使わない（誤帰属焼き付き防止）
- マイナンバー等は redaction RPC で隔離可能に保つ

---

## 1. Slack（優先度1）

### 位置づけ・白ラベル形態

- **当社1アプリを各顧客ワークスペースにインストール**する形。LINEのような事務所ごとのアカウント作成は不要。
- **白ラベルの限界**: アプリ名・アイコンはアプリ単位でグローバル（例「AgentPM 秘書」固定）。
  事務所ごとの秘書名にはできない（やるなら事務所ごとにアプリを作ることになり運用が破綻する。妥協点として許容する）。

### 実装可能条件（前提）

| 条件 | 状態 |
|------|------|
| Slack App（signing secret / OAuth） | **既存**（`docs/SLACK_SETUP.md` で作成済み） |
| 署名検証（HMAC v0・5分リプレイ窓） | **既存実装** `src/lib/slack/verify.ts` そのまま流用可 |
| OAuth マルチワークスペース配布 | **既存実装** `src/lib/slack/oauth.ts` + `/api/slack/authorize` `/callback` |
| 送信・Block Kit・interactions | **既存実装** `client.ts` / `blocks.ts` / `/api/slack/interactions` |
| チャンネル⇔space紐付け | **既存実装**（既存Slack連携の設定UI） |
| メッセージ受信（履歴読み取り） | **未実装** — Event Subscriptions の追加が必要 |

既存資産が最も厚く、**新規実装は「message イベントの受信→channel_messages 記録」と「digest描画のBlock Kit化」が中心**。

### API要点

- **受信**: Events API。`message.channels` / `message.groups` イベント購読 ＋ bot が対象チャンネルのメンバーであること
  ＋ `channels:history` / `groups:history` スコープが必要。**botを招待したチャンネルの全発言が受信できる**
  （LINEグループと同じ受動読み取りが可能 = digest成立）。
- **ACK制約**: イベントは**3秒以内に200を返す**必要。処理は非同期化（現行LINE webhookは同期処理なので、
  Slackでは記録→即200→後続処理の分離を検討）。リトライは `x-slack-retry-num` ヘッダ付き（event_id で dedupe）。
- **送信**: `chat.postMessage`。**通数課金なし**（LINEのpush課金の議論は不要）。レート制限は概ね 1msg/秒/チャンネル。
- **消し込みUI**: Block Kit ボタン → 既存 `/api/slack/interactions` に digest_done アクションを追加。
  LINEのpostbackと同型（原子的消し込み＋org検証＋証跡記録をそのまま流用）。
- **添付**: `files:read` スコープ＋ `url_private` を bot token 付きでダウンロード→Storage保存。
- **個人DM**: `im:write` で制約なし（友だち追加の壁がない＝二層設計はSlack不要。identityは最初から記名）。
- **プラン制約**: 顧客がフリープランでも**リアルタイムのイベント受信には影響なし**（90日履歴制限は過去分の遡りにだけ効く。
  遡及取り込みはどのみちやらない設計なので問題なし）。

### 配布・審査

- App Directory 掲載は審査必要だが、**掲載せず「配布URLの手動共有」なら審査不要**（unlisted distribution）。当面はこれで行く。
- 顧客側の作業は「インストールURLを踏んで承認→botを対象チャンネルに `/invite`」の2つだけ。

### 実装タスク分解（目安）

1. ChannelAdapter 抽出リファクタ（§0-2）
2. `slack` adapter: verify（既存流用）/ normalizeEvents（message/member_joined_channel/app_uninstalled）/ sendText / sendDigest（Block Kit）
3. Event Subscriptions ルート新設（`/api/channels/slack/webhook` — 既存 `/api/slack/webhook` は既存連携用なので分ける or 統合を判断）
4. interactions に digest_done 追加、channel_accounts への workspace 登録フロー（OAuth callback から insert）
5. スコープ追加に伴う**再インストール案内**（既存導入ワークスペースはスコープ追加で再認可が必要）

---

## 2. Chatwork（優先度2）

### 位置づけ・白ラベル形態

- **事務所ごとに bot 用 Chatwork アカウント**を用意する形。アカウント名＝秘書名にできるので**白ラベル度はLINEと同等に高い**。
- 士業・中小企業と相性が良い（顧問先がChatwork率高め）。

### 実装可能条件（前提）

| 条件 | 内容 |
|------|------|
| bot用アカウント | 事務所ごとに1つ。**メールアドレスが必要**（払い出し方針を先に決める: 当社ドメインでエイリアス発行が現実的） |
| APIトークン | bot アカウントの「動作設定→API」から発行（アカウント単位）。組織契約だと管理者がAPI利用を制限できる点に注意（要確認） |
| フリープランのAPI可否 | **要確認**（プランによるAPI/webhook制限の最新仕様）。顧客側ではなく**bot側アカウントのプラン**が問題になる |
| Webhook | アカウント単位で管理画面から作成。**作成数上限あり（要確認）** |

### API要点

- **認証**: REST + `X-ChatWorkToken` ヘッダ（アカウント単位トークン）。credentials_encrypted にトークンを暗号化保存。
- **受信**: Webhook（管理画面で作成）。ルームイベント（指定ルームの全発言）とアカウントイベント（メンション/DM）がある。
  **ルームイベントで受動読み取り可能 = digest成立**。署名は作成時に発行されるトークンでの HMAC-SHA256（base64）検証（要確認: ヘッダ名等）。
- **送信**: `POST /rooms/{room_id}/messages`。通数課金なし。**レート制限 300リクエスト/5分/トークン**（要確認）—
  digest一斉配信で引っかかり得るので送信キューに間隔制御を入れる。
- **消し込みUI**: ボタンUIなし。**「完了N」返信（実装済みのコマンドをそのまま流用）＋ Chatwork純正タスクへのAPI起票**
  （`POST /rooms/{room_id}/tasks`、to_ids/body/limit）。純正タスク起票は「Chatworkの中で完結する」強い訴求になる。
  純正タスクの完了をこちらへ同期する方向（task_status変更の検知）はwebhookイベントの有無を要確認 — 無ければ一方向起票のみ。
- **添付**: ファイルAPIでダウンロード→Storage保存（URLは認証必要・短命前提で扱う）。
- **グループ招待**: bot アカウントを普通のメンバーとしてルームに招待（コンタクト承認が要る場合あり — 事務所側に bot を
  コンタクト追加してもらう手順を運用に含める）。

### 実装タスク分解（目安）

1. ChannelAdapter 抽出後、`chatwork` adapter（verify/normalize/sendText/sendDigest テキスト描画）
2. `/api/channels/chatwork/webhook` 新設（ルームイベント→channel_messages 記録）
3. 「完了N」はチャネル非依存実装済みのため流用。純正タスク起票は digest 配信時のオプション（org設定でon/off）
4. bot アカウント運用手順書（メール払い出し→アカウント作成→トークン発行→webhook作成→channel_accounts登録）

---

## 3. Google Chat（優先度3）

### 位置づけ・白ラベル形態

- **当社1アプリ（Google Cloudプロジェクト）を各社Workspaceに配布**。アプリ名はグローバル（Slackと同じ白ラベル限界）。
- **顧客が Google Workspace 契約であることが前提**（個人 @gmail.com では Chat アプリを使えない）。ターゲット層と重なるかは疑問 — 需要が見えてから着手。

### 実装可能条件（前提・ここが最大の難所）

- **⚠ 受動読み取りの壁**: Google Chat アプリは通常、**@メンションされたメッセージとDMしか受け取れない**。
  スペースの全発言を受動的に読むには **Google Workspace Events API のサブスクリプション**（メッセージリソース購読、
  `chat.messages` 系スコープ＋管理者同意）が必要（要確認: 対象プラン・同意フロー・購読の有効期限と更新）。
  **これが成立しないと digest が成り立たない**ため、着手前にPoCで検証すること。LINE/Slack/Chatworkとの最大の違い。
- 配布は Marketplace（限定公開/公開。公開は審査あり）または管理者による手動設定。顧客側の **Workspace 管理者の関与が必須**
  （管理者がいない小規模店舗には向かない）。

### API要点

- **受信**: HTTPエンドポイント型アプリ。リクエストは Google 発行の Bearer JWT を検証（audience=プロジェクト番号、要確認）。
- **送信**: サービスアカウント認証で `spaces.messages.create`。通数課金なし。
- **消し込みUI**: Cards v2 のボタン → インタラクションイベントで受ける（LINE postback と同型に落とせる）。
- **添付**: メディアAPIでダウンロード→Storage保存。

### 実装タスク分解（目安）

1. **PoC先行**: Workspace Events API でスペース全発言の購読が実運用に耐えるか（購読更新・レイテンシ・スコープ同意のUX）を検証
2. PoC成立後に adapter 実装（verify=JWT検証 / sendDigest=Cards v2）
3. 配布手順書（管理者向け）— 他チャネルより顧客側手順が重いことをLP/営業資料にも反映

---

## 4. メール（受信基盤から必要）

### 位置づけ

- 送信は既存基盤あり（**Resend**、`src/lib/email/`）。**未実装なのは受信**（顧問先からの返信・添付を channel_messages に取り込む）。
- グループ概念がないため digest は対象外。**1対1の回収・催促・証跡チャネル**として位置づける（v0.1計画どおり）。
- 経理担当がいる会社の主チャネル（ペルソナ分岐は AI_SECRETARY_DESIGN v0.1 参照）。

### 実装可能条件（前提となる意思決定）

| 決めること | 選択肢・論点 |
|-----------|-------------|
| 受信方式 | Resend の inbound 対応状況を最初に確認（要確認・対応していれば送受信一社で最も楽）。だめなら SendGrid Inbound Parse / Postmark / Mailgun Routes / SES受信 のいずれか |
| 受信ドメイン設計 | 事務所ごと白ラベルアドレス（例: `aoi@<office>.agentpm.app` のサブドメイン方式 or 事務所独自ドメインのMX委任）。**独自ドメインMX委任は事務所側のDNS作業が発生**するので初期はサブドメイン方式が現実的 |
| スレッド突合 | `Message-ID` / `In-Reply-To` / `References` ヘッダで channel_messages に会話スレッドを再構成。envelope の宛先アドレス（＋アドレス拡張 `aoi+<code>@`）で org / space 逆引き |
| なりすまし対策 | 受信時の SPF/DKIM/DMARC 検証結果をpayloadに記録（証跡の信頼性）。送信側ドメインの DMARC 整備も同時に |

### API要点・注意

- **identity 突合**: From アドレス＝ channel_identities の external_user_id 相当。LINEのリンクコードに相当するものは
  「こちらから送った宛先への返信」で自然に成立するため不要（新規の受信のみコード方式を検討）。
- **添付**: 受信ペイロードから即 Storage 保存（インバウンドプロバイダの保存期限は短い）。サイズ上限（25MB級）と
  ウイルススキャンの要否を判断。
- **消し込み/アクション**: ボタンがないので**層2アクショントークンのリンク**（email-action の一般化）が対応物。
  メールチャネルの本格化は層2実装とセットで計画する。
- **落とし穴**: 自動応答ループ（OoO往復）対策に `Auto-Submitted` ヘッダ検査、配信不能（バウンス）の記録、
  メーリングリスト経由の膨張に注意。

---

## 5. 優先順位と着手条件（まとめ)

| チャネル | 受動読み取り(digest) | 白ラベル | 新規実装量 | 着手条件 |
|---------|---------------------|---------|-----------|---------|
| Slack | ◎ botを招待したチャンネル全発言 | △ アプリ名固定 | **小**（既存資産流用） | 顧客要望が1件でも出たら |
| Chatwork | ◎ ルームイベント | ◎ botアカウント名 | 中 | bot用メール払い出し方針の決定＋プラン制約の確認 |
| Google Chat | **⚠ Events API購読が前提（PoC必須）** | △ アプリ名固定 | 大 | Workspace契約顧客の実需＋PoC成立 |
| メール | −（1対1のみ） | ◎ アドレス設計次第 | 大（受信基盤から） | 層2アクショントークンの設計とセットで |

- どのチャネルも**最初のPRは ChannelAdapter 抽出リファクタ**（§0-2）。これはチャネル非依存なので先行実装してよい。
- 通数課金があるのはLINEだけ。他チャネルでは reply/push の使い分けロジックは不要（adapter内で吸収）。
- 運営者側の作業チェックリストは `docs/CHANNEL_SETUP_TASKS.md` を正とし、本書はその背景（なぜその手順か・何が制約か）を残す。
