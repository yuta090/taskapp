# WhatsApp 接続プロビジョニング手順（運用者向け）

WhatsApp は **1:1 の DM 専用**チャネル（グループ非対応）で、事務所（org）が**自社の WhatsApp Business アカウントを白ラベルで接続**する **Pro 専有**の連携です（共通LINE のようなプラットフォーム共有ではなく、org ごとに自社アカウントを繋ぐ）。コードは実装・本番反映済み（PR #389）。本書は**本番稼働に必要な運用者側の準備**を扱います。

```
[受信] お客さんの WhatsApp DM ──▶ Meta Cloud API ──POST──▶ /api/channels/whatsapp/webhook/{accountId} ──▶ 記録／突合コードで相手先に紐付け
[送信] 秘書のまとめ・通知 ──▶ Send API(graph.facebook.com) ──▶ お客さんの WhatsApp
[紐付け] お客さんが合言葉(突合コード)を DM で送る ──▶ その番号(wa_id)が相手先(space)に紐付く
```

## 設計の要点
- **DM 専用・owner_type='org'**（自社の WhatsApp Business アカウント）。`platform` 共有アカウントは非対応（受信は 400 で弾く）。
- **紐付けは合言葉（突合コード）**。事務所が相手先へ渡した突合コードを、お客さんが WhatsApp DM で送り返すと、その電話番号(wa_id)が相手先(space)に紐付く。**突合コードはチャネル横断**で、同じ1枚が LINE でも WhatsApp でも通る（償還した側で紐付けが作られる）。
- **越境拒否・沈黙**：他 org のコードには常に無反応。未紐付けの通常メッセージには返信しない（記録のみ）。
- **受信は fail-closed**：`app_secret` 未設定・署名不一致・未知アカウントは 401、何も書かない。`platform` は 400。
- 新規接続は **Pro 専有**（entitlements `own_line_account` 系）。接続画面（`/{orgId}/secretary/connect/whatsapp`）が資格情報の入力を案内する。

## A. Meta 側の用意（リードタイム最長・最優先）
1. **Meta for Developers** でアプリを作成し、**WhatsApp（Cloud API）**プロダクトを追加。
2. **WhatsApp Business Account（WABA）**と**電話番号**を用意し、**Phone Number ID** を控える（＝資格情報 `phone_number_id`）。
3. **System User アクセストークン**（長期）を発行（＝`access_token`）。Graph API 呼び出し（送信）に使う。
4. アプリの**基本設定**から **App Secret** を控える（＝`app_secret`）。受信 Webhook の `X-Hub-Signature-256` 署名検証に必須。
5. **ビジネス認証（Business Verification）**を完了する。本番の対外メッセージ送信に必須で、審査に時間がかかるので最初に着手する。
   - 24時間のカスタマーサービスウィンドウ外はテンプレートメッセージのみ（v1 は本文テキストのみ対応）。

## B. 接続画面で登録（org 管理者・Pro）
1. 事務所の管理者が `/{orgId}/secretary/connect/whatsapp` を開く（Free org は Pro 導線が出る）。
2. `access_token`・`phone_number_id`・`app_secret` を入力して登録。
3. 登録時に**サーバーが `verify_token` を自動生成**し、**一度だけ平文で表示**する。この値を控える（次の C で Meta に貼る）。
   - `verify_token` はオペレーターが考えるものではなく、サーバー生成値をそのまま Meta 側に貼る運用。

## C. Meta の Webhook を設定
1. Meta アプリの **WhatsApp → Configuration → Webhook** で：
   - **コールバック URL** = `https://<本番>/api/channels/whatsapp/webhook/<accountId>`（`<accountId>` は B で作成された channel account の ID）。
   - **確認トークン（Verify Token）** = B でサーバーが生成した `verify_token`。
   - 保存時に Meta が `GET`（`hub.mode=subscribe` / `hub.verify_token` / `hub.challenge`）で疎通確認する。一致すれば challenge を返して購読成立。
2. **messages** フィールドを購読（サブスクライブ）する。

## D. 動作確認（本番稼働後）
- お客さんが WhatsApp から合言葉（突合コード）を DM 送信 → その番号(wa_id)が相手先(space)に紐付き、確認返信が届く。
- 以降のお客さんの発言が `channel_messages` に相手先付きで記録される（拾い成立）。
- 秘書のまとめ・通知が Send API でお客さんに届く（24時間ウィンドウ内はテキスト）。
- 他 org のコードや未紐付けの通常メッセージには**返信しない**（沈黙）。内部ユーザーの認証コード(TA-)が誤って送られた場合はログにマスクして残し失効させる。

## メモ
- **マイグレーション不要**（`channel` の許容集合は既に whatsapp を含む）。
- registry のステータスは **beta**（Meta のビジネス認証が運用ゲートのため GA へは上げていない）。
- 送信アダプタ＝`src/lib/channels/adapters/whatsapp.ts`、受信＝`src/lib/channels/whatsapp/webhookHandler.ts`、受け口＝`src/app/api/channels/whatsapp/webhook/[accountId]/route.ts`。
