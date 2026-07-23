# Facebook Messenger 接続プロビジョニング手順（運用者向け）

Messenger は **1:1 の DM 専用**チャネル（グループ非対応）で、事務所（org）が**自社の Facebook ページを白ラベルで接続**する **Pro 専有**の連携です。構造は WhatsApp の双子（どちらも Meta・DM・PSID・署名検証＋Send API）。コードは実装・本番反映済み（PR #392）。本書は**本番稼働に必要な運用者側の準備**を扱います。

```
[受信] お客さんの Messenger DM ──▶ Meta ──POST──▶ /api/channels/messenger/webhook/{accountId} ──▶ 記録／突合コードで相手先に紐付け
[送信] 秘書のまとめ・通知 ──▶ Send API(graph.facebook.com /me/messages) ──▶ お客さん
[紐付け] お客さんが合言葉(突合コード)を DM で送る ──▶ その PSID が相手先(space)に紐付く
```

## 設計の要点
- **DM 専用・owner_type='org'**（自社の Facebook ページ）。`platform` 共有は非対応（受信は 400）。
- **紐付けは合言葉（突合コード）**。事務所が渡した突合コードをお客さんが Messenger DM で送り返すと、その **PSID（Page-Scoped User ID）**が相手先(space)に紐付く。**突合コードはチャネル横断**（同じ1枚が LINE / WhatsApp / Messenger で通り、償還した側で紐付けが作られる）。
- **越境拒否・沈黙**：他 org のコードには常に無反応。未紐付けの通常メッセージには返信しない。
- **受信は fail-closed**：`app_secret` 未設定・署名不一致・未知アカウントは 401。`platform` は 400。
- 送信のトークンは URL に載せず `Authorization: Bearer` ヘッダで渡す（ログ漏れ防止）。
- 新規接続は **Pro 専有**。接続画面（`/{orgId}/secretary/connect/messenger`）が案内する。

## A. Meta 側の用意（リードタイム最長・最優先）
1. **Meta for Developers** でアプリを作成し、**Messenger** プロダクトを追加。
2. 接続する**Facebook ページ**を用意し、そのページに紐づく **Page Access Token** を発行（＝`page_access_token`）。Send API の送信に使う。
3. アプリの**基本設定**から **App Secret** を控える（＝`app_secret`）。受信 Webhook の `X-Hub-Signature-256` 署名検証に必須。
4. **アプリレビュー（App Review）**：本番で任意のお客さんに送受信するには **`pages_messaging` の Advanced Access** ＋ **ビジネス認証**が必要。審査があり時間がかかるので最初に着手する。
   - 24時間ウィンドウ外はメッセージタグが要る（v1 は本文テキスト・`messaging_type: RESPONSE` のみ対応。お客さんが合言葉を送った直後の確認返信はウィンドウ内で成立）。

## B. 接続画面で登録（org 管理者・Pro）
1. 事務所の管理者が `/{orgId}/secretary/connect/messenger` を開く。
2. `page_access_token`・`app_secret` を入力して登録。
3. 登録時に**サーバーが `verify_token` を自動生成**し、**一度だけ平文で表示**する。控えて次の C で Meta に貼る。

## C. Meta の Webhook を設定
1. Meta アプリの **Messenger → Settings → Webhooks** で：
   - **コールバック URL** = `https://<本番>/api/channels/messenger/webhook/<accountId>`（`<accountId>` は B で作成された channel account の ID）。
   - **確認トークン（Verify Token）** = B でサーバーが生成した `verify_token`。
   - 保存時に Meta が `GET`（`hub.mode=subscribe` / `hub.verify_token` / `hub.challenge`）で疎通確認。一致で購読成立。
2. **messages** フィールドを購読し、対象の**ページを Webhook にサブスクライブ**する。

## D. 動作確認（本番稼働後）
- お客さんが Messenger から合言葉（突合コード）を DM 送信 → その PSID が相手先(space)に紐付き、確認返信が届く。
- 以降のお客さんの発言が `channel_messages` に相手先付きで記録される（拾い成立）。`message.mid` で重複排除。
- delivery/read/postback など本文の無いイベントは無視。他 org のコード・未紐付けの通常メッセージには返信しない（沈黙）。

## メモ
- **マイグレーション不要**（`channel` の許容集合は既に messenger を含む）。
- registry のステータスは **beta**（Meta アプリレビューが運用ゲートのため）。
- 送信アダプタ＝`src/lib/channels/adapters/messenger.ts`、受信＝`src/lib/channels/messenger/webhookHandler.ts`、受け口＝`src/app/api/channels/messenger/webhook/[accountId]/route.ts`。
