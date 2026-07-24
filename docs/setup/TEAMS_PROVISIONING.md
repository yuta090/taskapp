# Microsoft Teams 接続プロビジョニング手順（運用者向け）

Teams は2部構成です。**送信・受信ともコード実装済み**（送信=PR #391、受信=PR-1「入口＋claim bootstrap」／PR-2「取り込み＋完了N」／PR-3「能動送信（proactive）＋本書」の3PR）。本書は**本番稼働に必要な運用者側の準備**を扱います。org 自社接続（Part 1）はすぐ使えますが、共通（platform）Bot での受信（Part 2）は**運用者のプロビジョニング作業（Entra/Azure Bot登録・配布）が完了するまで実質的に動きません**（コードは待機中）。

```
[送信]     秘書のまとめ・通知
             ├─ org自社接続(Part 1・即使用可)   ──▶ Power Automate Workflows(api.powerplatform.com) ──▶ Teamsチャネル(Adaptive Card)
             └─ 共通Bot(Part 2・要プロビジョニング) ──▶ Bot Framework Connector(POST /v3/conversations) ──▶ claimed済みチャネルへ能動投稿(text)
[受信]     Teams（標準チャネルの全発言） ──▶ /api/channels/teams/messages（単一 messaging endpoint・Bot Framework JWT検証）
             ├─ claimed（紐付け済み）→ 記録（channel_messages）＋「完了N」で申し送りタスク完了
             └─ limbo（未紐付け）    → 合言葉が正準形なら claim bootstrap（それ以外は完全沈黙）
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

## Part 2. 受信（拾い成立）＋ 共通Bot能動送信 — **実装済み（PR-1/PR-2/PR-3）・要プロビジョニング**

@メンション無しで全発言を拾うには **Azure Bot Service + Bot Framework + RSC（Resource-Specific Consent）** が必要です。設計は Fable 裁定で確定済み（下記）。**コードは3PRとも実装済み**：
- **PR-1**（`/api/channels/teams/messages` の入口・JWT検証・claim bootstrap）
- **PR-2**（claimed グループの通常発言取り込み＋「完了N」・group.metadataへのserviceUrl等の反映）
- **PR-3**（朝のまとめ digest を claimed グループへ Bot Framework Connector で能動送信＝proactive。本書）

コードは待機状態で、**運用者のプロビジョニング（下記A〜D）が完了して初めて本番で動く**（Entra/Azure Bot未登録の間は「未 claim（limbo）」にすら到達しない＝入口へ何も届かない）。

### 設計の要点（Fable 裁定）
- **プラットフォーム集約**：当社の**単一マルチテナント Azure Bot ＋ 単一 Teams アプリ**を配布（共通LINE / Google Chat と同型）。org 別 Bot は作らない（顧客に Azure 作業を強いず、テナント分離は claim が正）。
- **購読管理は不要**：RSC を宣言した Bot は、標準チャネルの**全メッセージが購読管理なしで messaging endpoint に push される**（Google Chat の Pub/Sub 購読テーブル・cron に相当するものが要らない）。
- **受信入口は1本**：`/api/channels/teams/messages`。claimed チャネル＝記録＋「完了N」、limbo（未紐付け）＝合言葉の claim bootstrap（コード正準形でなければ完全沈黙）。Slack/Telegram と同じ「単一入口型」。
- **プライベート/共有チャネルは対象外**（Bot が追加できず購読が張れない）＝標準チャネルのみ。
- **fail-closed**：env 欠落＝500／Bot Framework JWT の署名・issuer(`https://api.botframework.com`)・audience(App ID)・期限が不正＝401。**JWT の `serviceurl` クレームと `activity.serviceUrl` の一致検証必須**（偽 serviceUrl への返信＝トークン持ち出し/SSRF を塞ぐ）。内容起因の失敗は 200（Bot Framework 再送のループ回避）。
- **能動送信（PR-3）**：Teams（Bot Framework）は Google Chat と異なり HTTP レスポンス自体が返信にならない非同期チャネルのため、朝の申し送り digest（channel-digest cron）は claimed グループの `channel_groups.metadata.serviceUrl`（PR-2 が受信のたびに保存）を使い、Connector REST（`POST {serviceUrl}/v3/conversations`）へ明示的に投稿する。org 自社接続（Part 1・Power Automate Workflows／`webhook_url`）は本 PR で一切変更していない——共通Bot（platform）だけが webhook_url を持たないため、この能動送信経路にフォールバックする。
  - claim 直後でまだ一度も受信していないグループは `serviceUrl` が未保存のため、その回の digest 送信だけ一時失敗としてスキップされる（次回いずれかの発言を受信すれば `metadata.serviceUrl` が埋まり、以降の digest から送れるようになる）。
  - **紐づけ方法による差（重要）**：**限定合言葉（code_only）で自動紐づけした場合は、償還メッセージ自身の `serviceUrl` をその場で保存するため、初回の朝の申し送りから届く**。一方、**承認制（web_approval）で紐づけたグループは、グループがまだ active化されていない時点では保存できないため、承認後にそのグループで最初の発言があるまで能動送信（朝の申し送り）が届かない**（発言のタイミングで `serviceUrl` が保存され、以降の digest から届くようになる）。紐づけ方法を選べる場面では、これを踏まえて案内すること。

### 運用者タスク（本番稼働させるための前提）
1. **Entra アプリ登録（マルチテナント）** ＋ client secret 発行 → env `TEAMS_BOT_APP_ID` / `TEAMS_BOT_APP_PASSWORD` へ。
2. **Azure Bot リソース**作成（上記 App ID 紐付け）＋ **Teams チャネル有効化** ＋ messaging endpoint = `https://<本番>/api/channels/teams/messages`。
3. **Teams アプリ manifest** を作成：bot 定義（`scopes: ["team"]`）＋ `webApplicationInfo` ＋ `authorization.permissions.resourceSpecific: [{ name: "ChannelMessage.Read.Group", type: "Application" }]` → zip。
4. **配布**：当面は**顧客テナント管理者による組織アプリカタログへのカスタムアップロード**（AppSource 審査を回避して即開始）。将来 Marketplace 掲載は別判断。
5. **顧客の3手順**：①管理者がカタログ登録／インストール許可 → ②**チームのオーナーがチームに追加**（RSC 同意はこの操作に内包・独立トグルではない）→ ③合言葉を @bot で投稿。
   - Google Chat より①の管理者負担が一段重い（カスタムアプリ許可＋RSC オーナー同意が無効なテナントは詰む）。**活性化の摩擦としてセールス側に明示**すること。

### A. 本番の環境変数（2つ・DBに鍵を置かない）
| env | 値 |
|-----|-----|
| `TEAMS_BOT_APP_ID` | Entra アプリの Application (client) ID（Bot Framework JWT の audience 検証・トークン取得の client_id に使用） |
| `TEAMS_BOT_APP_PASSWORD` | Entra アプリの client secret（トークン取得の client_secret に使用。DBには絶対に入れない） |

いずれか欠落時は：受信側（`/api/channels/teams/messages`）は **500 で fail-closed**（JWT検証不能・既知鍵で黙って通さない）。送信側（共通Bot proactive）は **一時失敗**として digest がその回だけスキップされる（cron 自体は落ちない・env を設定すれば次回から復旧）。

### B. 本番DBのマイグレーション適用（`apply-migration.sh` ＋ `applied_migrations` 手動記録）
- `supabase/migrations/20260724091826_teams_inbound_bootstrap.sql`（`channel_groups.metadata` 列の追加。PR-1で先行追加済み・PR-2/PR-3が書き込み/読み取りに使用）

### C. 共通アカウント（platform 行）を作る（service role で1回だけ）
```bash
# scripts/seed-platform-teams-account.mjs（冪等・既存があれば何もしない）
# credentials に秘匿鍵は入らない（App ID/Password は env）。SYSTEM_ENCRYPTION_KEY が必要。
SUPABASE_SERVICE_ROLE_KEY=... SYSTEM_ENCRYPTION_KEY=... node scripts/seed-platform-teams-account.mjs
```
`owner_type='platform'`・`channel='teams'`・`org_id=NULL` の行が1つできる。

### D. 顧客オンボーディング
接続画面（`/{orgId}/secretary/connect/teams`）は現状 **org 自社接続（Part 1・`webhook_url`）専用**のフォームのみを持つ。共通Bot（Part 2）の合言葉発行は `POST /api/channels/group-claims/issue`（body に `channel: 'teams'` を指定）が既に対応済み（Pro 専有・`external_chat_channels` entitlement＋`orgExternalChatGroupCapacity` で容量判定）。発行後の流れは「顧客の3手順」（上記5.）どおり：合言葉を @bot でチャネルに投稿 → `channel_group_claims` に pending として現れる → 内部ユーザーが承認（`POST /api/channels/group-claims/approval`）でグループが active 化。合言葉発行の専用UI導線（他チャットの共有グループ紐付け画面と統合するか等）は本書時点で未整備——API は使えるが顧客向けの発行ボタンをどこに置くかは別途判断が要る。

### 唯一の未実証（実機確認が必要）
- **RSC 宣言済み Bot で「@メンション無しのメッセージが本当に endpoint に届くか」**をステージング（テストテナント）で確認。万一「@メンション時しか届かない」なら、Graph の change notification（subscription）方式へ再設計（その場合も入口・合言葉の床は不変）。
- 上記が確認できるまで、Part 2 は**コード完成済みだが本番未検証**として扱うこと。

詳細な裁定内容はプロジェクトメモリ `teams-inbound-architecture` を参照。

---

## メモ
- 送信・受信ともコードの registry ステータスは **beta**（`proOnly: true`）。送信アダプタ＝`src/lib/channels/adapters/teams.ts`（org=Workflows Webhook優先／platform=Connector proactiveへフォールバック）、受信入口＝`src/app/api/channels/teams/messages/route.ts`、定義＝`src/lib/channels/registry.ts` の `teams`。
- 受信・能動送信は**コード実装済み**（`/api/channels/teams/messages` は存在する）が、本番稼働には上記 Entra/Azure Bot 登録・配布・env 設定が前提。未設定の間は入口に何も届かず、共通Bot digest は一時失敗として静かにスキップされる（他チャネルの digest は影響しない）。
