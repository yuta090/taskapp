# チャネル接続 セットアップタスク一覧（運営者作業）

AI秘書のチャネル接続で**コードではなく運営者（高橋さん）側の作業**として必要なものの正本。
実装状況に応じて「今すぐ着手可」と「実装後に着手」に分けている。完了したらチェックを付けて更新すること。

関連ドキュメント:
- 実装仕様: `docs/spec/CHANNEL_PLUMBING_SPEC.md`（Stage 1 配管・登録SQL）
- 設計: `docs/spec/AI_SECRETARY_STAGE2_DESIGN.md`（§10 マルチチャネル展開）
- Slack App 作成手順: `docs/SLACK_SETUP.md`

---

## 1. LINE（実装済み・今すぐ着手可）

事務所/店舗（org）ごとに1つの LINE 公式アカウントを作る白ラベル構成。**未認証アカウントでOK（審査不要）**。プロバイダーは後から変更できないので、作成時のプロバイダー名に注意（顧客企業名義で作るなら顧客のLINEビジネスIDで作成し、当社を運用担当者として招待する形が正）。

### 1-1. チャネル作成（事務所/店舗ごとに繰り返し）

- [ ] LINE公式アカウント作成（[LINE Official Account Manager](https://manager.line.biz/)）
  - アカウント名 = 白ラベル秘書名（例: 「山田会計事務所 秘書」）
- [ ] [LINE Developers](https://developers.line.biz/) で Messaging API を有効化（チャネル作成）
- [ ] **チャネルアクセストークン（長期）を発行**（Messaging API設定タブ）
- [ ] **チャネルシークレット**を控える（チャネル基本設定タブ）
- [ ] **bot の userId（`U` で始まる）**を控える（チャネル基本設定の「あなたのユーザーID」ではなく **bot の basic ID 横の userId**。不明なら webhook 検証イベントの `destination` で確認可能）

### 1-2. LINE Official Account Manager 側の設定（重要・忘れやすい）

- [ ] **応答設定**: 「応答メッセージ」= オフ、「あいさつメッセージ」= オフ、「Webhook」= オン
  （OA側の自動応答が生きていると bot の応答と二重になる）
- [ ] **「グループ・複数人トークへの参加を許可する」= オン**（グループdigest の前提。デフォルトはオフ）

### 1-3. Developers コンソール側の設定

- [ ] Webhook URL: `https://agentpm.app/api/channels/line/webhook`（全事務所共通の単一エンドポイント）
- [ ] 「Webhookの利用」= オン → **「検証」ボタンで疎通確認**（成功すればOK）

### 1-4. DB 登録（service role で実行）

- [ ] `channel_accounts` に登録 — SQL は `docs/spec/CHANNEL_PLUMBING_SPEC.md` §4 のとおり
  （org_id / line_bot_userId / 表示名 / channel_secret+access_token を `encrypt_system_secret` で暗号化）

### 1-5. 実機E2E（1アカウントごとの受け入れ確認）

- [ ] 友だち追加 → 挨拶＋記録明示の一文が届く
- [ ] コンソール（`/{orgId}/secretary`）でリンクコード発行 → LINEでコード送信 → 突合確認の返信
- [ ] コンソールから送信 → LINEに届く／LINEから返信 → タイムラインに載る
- [ ] グループに招待 → 参加挨拶＋リンクコード案内 → コードでspace紐付け
- [ ] グループで業務会話 → **翌朝7:00** に申し送りdigestが届く → 「完了」ボタン/「完了N」で消し込み
- [ ] コンソールで bot 無効化 → 送信が409になる／受信は記録され続ける

### 1-6. 任意（あとでよい）

- [ ] リッチメニュー設定（トークンポータルへの導線。友だち特典=Stage 2c実装後でよい）
- [ ] アカウントのプロフィール画像・あいさつ文言の白ラベル調整

---

## 2. Slack（アダプタ未実装・優先度1。アプリ自体は既存流用）

既存のSlack連携（webhook/署名検証/送信/チャンネル⇔space紐付け）を流用予定。**当社1アプリを各ワークスペースにインストール**する形（LINEと違い事務所ごとの作成は不要）。

### 今すぐできる準備

- [ ] 既存 Slack App（`docs/SLACK_SETUP.md` で作成したもの）の稼働確認
  - Vercel 本番に `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_SIGNING_SECRET` / `SLACK_STATE_SECRET` が設定済みか確認
- [ ] Slack App を**組織外ワークスペースに配布できる状態**にするか方針決め（App Directory 公開審査 or 顧客ごとに手動インストールURL共有。当面は後者で可）

### アダプタ実装後に必要

- [ ] Event Subscriptions の Request URL 設定（実装時に `/api/channels/slack/webhook` 等を用意する。既存の callback とは別）
- [ ] Bot Token Scopes の追加見直し（`groups:history` / `channels:history` / `im:write` / `users:read` などdigest用の読み取り系。実装時に確定）
- [ ] 顧客ワークスペースへのインストール手順書（マニュアル）作成

---

## 3. Chatwork（アダプタ未実装・優先度2）

**事務所ごとの bot 用 Chatwork アカウント**で白ラベル維持する構成。API はアカウント単位のトークン。

### 今すぐできる準備

- [ ] bot 用アカウントの発行方針を決める（事務所側でアカウントを1つ用意してもらう or 当社がメールアドレスを払い出して作成。**Chatworkアカウントにはメールアドレスが必要**）
- [ ] Chatwork API 利用可否の確認（無料プランはAPI利用に制限がある場合あり。対象顧客のプラン確認）

### アダプタ実装後に必要（事務所ごと）

- [ ] bot アカウントで **API トークンを発行**（動作設定→API）
- [ ] Webhook 設定（Chatwork管理画面から作成。URL は実装時に用意する `/api/channels/chatwork/webhook` 等）
- [ ] bot アカウントを対象ルームに招待
- [ ] `channel_accounts` に登録（channel='chatwork'、トークンを暗号化保存）

補足: Chatwork は純正タスク機能があるため、digest のタスクを **Chatwork タスクとしてAPI起票**する設計（Stage 2設計§10）。

---

## 4. Google Chat（アダプタ未実装・優先度3）

Google Workspace 前提。**当社1アプリ（Google Cloud プロジェクト）を各社 Workspace に配布**する形。配布に一手間あるため優先度低。

### アダプタ実装後に必要

- [ ] Google Cloud プロジェクトで **Google Chat API を有効化**
- [ ] Chat アプリの構成（アプリ名=秘書名は全社共通になる点に注意。白ラベル度はLINE/Chatworkより低い）
- [ ] 接続方式を HTTP エンドポイントに設定（実装時に用意する `/api/channels/gchat/webhook` 等）
- [ ] 配布設定: 顧客側 **Workspace 管理者にドメインインストールを依頼**する手順書作成
- [ ] `channel_accounts` に登録（channel='gchat'）

---

## 5. メール（受信基盤 未実装）

送信は既存基盤あり。**受信**（顧問先からの返信・添付をchannel_messagesに取り込む）は基盤選定から必要。

### 実装前に決めること

- [ ] 受信方式の選定（Resend/SendGrid の Inbound Parse、または独自ドメインのMX設定）
- [ ] 受信用ドメイン/アドレスの設計（事務所ごとの白ラベルアドレスにするか）

---

## 6. チャネル横断・その他の保留タスク

- [ ] **Vercel 環境変数 `LEAD_NOTIFY_EMAIL`**（LP相談フォームの通知先。未設定だと FROM_EMAIL 宛てに届く）— PR #205 のリリースで本番稼働中のため早めに
- [ ] GA 計測タグ（測定ID未決定・`gcloud auth application-default login` の再認証も必要）
- [ ] 店舗向け（飲食・接客）に **当社 LLM キーの用意**（現状 `callLlm` は org_ai_config 必須。店舗はAPIキーを持たないため当社キー内包の実装が別途必要 — これは実装タスクだが、**当社側でどのプロバイダのキーを使うかの決定**は運営判断）
- [ ] 白ラベル秘書名の決定（「あおい」は仮名・未決定。決定時に商標確認）

---

## 更新ルール

- チャネルのアダプタ実装が入ったら、該当セクションの「実装後に必要」を具体的なURL・スコープで確定させる
- 完了タスクはチェックを付け、事務所ごとの繰り返し作業（LINE 1-1〜1-5）は必要なら事務所別の台帳を別途起こす
