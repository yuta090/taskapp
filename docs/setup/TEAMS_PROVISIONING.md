# Microsoft Teams 接続プロビジョニング手順（運用者向け）

Teams は2部構成です。**送信は実装・本番反映済み（PR #391）**、**受信（拾い成立）は設計済みだがコードは未実装**（着手はご指示待ち）。本書は両方の運用者側の準備を扱いますが、**Part 2（受信）は「これから作るための設計手順」**である点に注意。

```
[送信・実装済] 秘書のまとめ・通知 ──▶ Power Automate Workflows の Webhook(api.powerplatform.com) ──▶ Teams チャネル(Adaptive Card)
[受信・未実装] 設計: 単一マルチテナント Azure Bot ──▶ /api/channels/teams/messages ──▶ 記録／合言葉で紐付け（Bot Framework）
```

---

## Part 1. 送信（実装済み・org 自社接続）

事務所（org）が**自社の Teams チャネルの Webhook を白ラベルで接続**する Pro 専有の連携です。

### ⚠ 重要な変更（2026年）
- 旧 **O365 コネクタ**（`webhook.office.com` の Incoming Webhook）は **2026年5月に廃止済み**。
- Power Automate の HTTP/Teams Webhook トリガーURLは 2025-11-30 に `logic.azure.com` → **`api.powerplatform.com`** へ移行。
- ＝**現行の受け口は Power Automate Workflows（`api.powerplatform.com`）だけ**。旧コネクタで作った URL は動かない。アダプタの許可ホストは新ドメインに対応済み（PR #391）。

### 接続手順（org 管理者・Pro）
1. 対象の Teams チャネルで **「ワークフロー」（Power Automate）** を開き、テンプレート **「Webhook 要求の受信時にチャネルに投稿する」**（Post to a channel when a webhook request is received）から作成。
2. 発行された **Webhook URL**（`https://<...>.environment.api.powerplatform.com/...`）を控える（＝資格情報 `webhook_url`）。
3. 接続画面 `/{orgId}/secretary/connect/teams` で `webhook_url` を登録。
4. 送信は Adaptive Card 形式。許可ホストは `api.powerplatform.com`（現行）／`logic.azure.com`・`webhook.office.com`（旧・移行猶予）。未許可ホストの URL は SSRF 防止で恒久失敗。

---

## Part 2. 受信（拾い成立）— **設計のみ・コード未実装**

@メンション無しで全発言を拾うには **Azure Bot Service + Bot Framework + RSC（Resource-Specific Consent）** が必要です。設計は Fable 裁定で確定済み（下記）。**実装（3PR）は未着手**なので、この Part は「動かすには何が要るか」を示す設計手順です。

### 設計の要点（Fable 裁定）
- **プラットフォーム集約**：当社の**単一マルチテナント Azure Bot ＋ 単一 Teams アプリ**を配布（共通LINE / Google Chat と同型）。org 別 Bot は作らない（顧客に Azure 作業を強いず、テナント分離は claim が正）。
- **購読管理は不要**：RSC を宣言した Bot は、標準チャネルの**全メッセージが購読管理なしで messaging endpoint に push される**（Google Chat の Pub/Sub 購読テーブル・cron に相当するものが要らない）。
- **受信入口は1本**：`/api/channels/teams/messages`。claimed チャネル＝記録＋「完了N」、limbo（未紐付け）＝合言葉の claim bootstrap（コード正準形でなければ完全沈黙）。Slack/Telegram と同じ「単一入口型」。
- **プライベート/共有チャネルは対象外**（Bot が追加できず購読が張れない）＝標準チャネルのみ。
- **fail-closed**：env 欠落＝500／Bot Framework JWT の署名・issuer(`https://api.botframework.com`)・audience(App ID)・期限が不正＝401。**JWT の `serviceurl` クレームと `activity.serviceUrl` の一致検証必須**（偽 serviceUrl への返信＝トークン持ち出し/SSRF を塞ぐ）。内容起因の失敗は 200（Bot Framework 再送のループ回避）。

### 運用者タスク（受信を作る場合の前提）
1. **Entra アプリ登録（マルチテナント）** ＋ client secret 発行 → env へ。
2. **Azure Bot リソース**作成（上記 App ID 紐付け）＋ **Teams チャネル有効化** ＋ messaging endpoint = `https://<本番>/api/channels/teams/messages`。
3. **Teams アプリ manifest** を作成：bot 定義（`scopes: ["team"]`）＋ `webApplicationInfo` ＋ `authorization.permissions.resourceSpecific: [{ name: "ChannelMessage.Read.Group", type: "Application" }]` → zip。
4. **配布**：当面は**顧客テナント管理者による組織アプリカタログへのカスタムアップロード**（AppSource 審査を回避して即開始）。将来 Marketplace 掲載は別判断。
5. **顧客の3手順**：①管理者がカタログ登録／インストール許可 → ②**チームのオーナーがチームに追加**（RSC 同意はこの操作に内包・独立トグルではない）→ ③合言葉を @bot で投稿。
   - Google Chat より①の管理者負担が一段重い（カスタムアプリ許可＋RSC オーナー同意が無効なテナントは詰む）。**活性化の摩擦としてセールス側に明示**すること。
6. **env**：`TEAMS_BOT_APP_ID` / `TEAMS_BOT_APP_PASSWORD`。
7. **マイグレーション**：受信実装時に platform account seed ＋ `channel_groups.metadata`（serviceUrl/teamId/tenantId 格納）追加を適用（実装 PR に同梱）。

### 唯一の未実証（実装前に実機確認）
- **RSC 宣言済み Bot で「@メンション無しのメッセージが本当に endpoint に届くか」**をステージング（テストテナント）で確認。万一「@メンション時しか届かない」なら、Graph の change notification（subscription）方式へ再設計（その場合も入口・合言葉の床は不変）。

詳細な裁定内容はプロジェクトメモリ `teams-inbound-architecture` を参照。

---

## メモ
- 送信の registry ステータスは **beta**。送信アダプタ＝`src/lib/channels/adapters/teams.ts`、定義＝`src/lib/channels/registry.ts` の `teams`。
- 受信は**未実装**（`/api/channels/teams/messages` はまだ存在しない）。本書 Part 2 は設計手順であり、コードが出来るまで本番の受信は動かない。
