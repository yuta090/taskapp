# Discord 受信（共有Bot）プロビジョニング手順（運用者向け）

Discord は他チャットと違い **メッセージ受信を HTTP Webhook で配信しない**ため、受信には
**常時接続の Gateway(WebSocket) ワーカー**が必要です。全体構成は次の3層で、本書は **(1) 共有Bot の
`channel_accounts` 行を作る**手順を扱います（(2)(3) は後続 PR）。

```
Discord ──Gateway(WS)──▶ [worker/discord-gateway] ──HMAC POST──▶ [/api/channels/discord/ingest] ──▶ channel_messages
   (2) PR3: 常駐ワーカー                              (2) PR2: 取り込みエンドポイント
(1) 本書: 共有Botの channel_accounts(platform) 行を作る（bot_token を暗号化保存）
```

## 設計の要点（Fable 裁定）
- **v1 は当社の共有プラットフォームBot 1つのみ**（`owner_type='platform'`・`org_id=NULL`）。org 白ラベルBotは後続。
  理由: Message Content Intent（本文読取）の Discord 審査を org 毎に通す摩擦を避け、当社が一度だけ通す。
- 帰属は LINE 共有bot と同じ **`channel_groups` + `channel_group_claims`**（確認コードでの承認）で確定。
  claim 単位は **テキストチャンネル**（`external_group_id` = channel snowflake、`external_parent_id` = guild id）。
- **新規紐付け（claim承認）は Pro 専有**（entitlements `external_chat_channels` / 上限 `maxExternalChatGroups`）。
- worker には **service-role鍵・SYSTEM_ENCRYPTION_KEY を持たせない**。worker が持つのは
  `DISCORD_BOT_TOKEN` / `INGEST_URL` / `INGEST_HMAC_SECRET` の3つだけ。

## 前提（Discord Developer Portal）
1. Application を作成し **Bot** を追加。**Bot Token** を控える（＝これを暗号化保存する）。
2. **Privileged Gateway Intents** で **MESSAGE CONTENT INTENT** を ON（本文取得に必須）。
   - Bot が **100 サーバー未満**なら審査不要で利用可。100到達前に verification 申請が要る点を運用タスク化する。
3. OAuth2 URL で Bot を対象サーバーに招待（scope: `bot`、権限: View Channels / Read Message History 等の最小限）。
4. 取り込ませたいテキストチャンネルで、後続の claim フロー（確認コード）により紐付ける。

## 共有Bot の channel_accounts 行を作る（service role で1回だけ）

資格情報は `credentials_encrypted` に **`encrypt_system_secret(json, <SYSTEM_ENCRYPTION_KEY>)`** で暗号化して入れる
（`channel_accounts` の資格情報は RLS で authenticated から一切読めない。service role のみ）。

> ⚠ **秘密の取り扱い**: `bot_token` と `SYSTEM_ENCRYPTION_KEY` を SQL に直書きすると
> クエリ履歴/ログに残り得る。**本番の Supabase では SQL エディタ履歴に残さない経路**（psql の
> `\set` + `PGOPTIONS`、または一時的な service-role セッション）で実行し、実行後は履歴を破棄すること。
> 可能なら下記「スクリプト方式」を推奨。

### SQL 方式（値は実物に置換。プレースホルダのままコミットしない）
```sql
-- SYSTEM_ENCRYPTION_KEY はアプリの環境変数と同一値を使う（env の SYSTEM_ENCRYPTION_KEY）。
insert into public.channel_accounts (owner_type, channel, display_name, credentials_encrypted, status)
values (
  'platform',
  'discord',
  'agentpm秘書 (Discord共有Bot)',
  encrypt_system_secret(
    '{"bot_token":"<DISCORD_BOT_TOKEN>"}',
    '<SYSTEM_ENCRYPTION_KEY>'
  ),
  'active'
);
```
制約により `owner_type='platform'` は `org_id` を持てない（自動で NULL）。`org` を誤って入れると
整合CHECK（`channel_accounts_owner_org_consistency`）で拒否される。

### スクリプト方式（推奨・秘密を env から読む）
`SUPABASE_SERVICE_ROLE_KEY` / `SYSTEM_ENCRYPTION_KEY` / `DISCORD_BOT_TOKEN` を環境変数で渡し、
`rpc('encrypt_system_secret', { plaintext, secret })` → `channel_accounts` へ INSERT する短いスクリプトを
一時実行する（ワンショット・秘密は端末に残さない）。※スクリプト本体は PR2 と併せて追加予定。

## ローテーション
Bot Token を再発行したら、(a) この行の `credentials_encrypted` を新トークンで再暗号化して UPDATE し、
(b) worker の `DISCORD_BOT_TOKEN` env を更新して再起動する。両者は同一トークンを指す二重保持
（app 側は claim 返信の REST 送信に、worker 側は Gateway 接続に使う）。

## 検証
- `select owner_type, channel, org_id, status from channel_accounts where channel='discord';`
  → `platform / discord / NULL / active` が1行。
- 資格情報の平文がどこにも出ない（このSQL/ログに token を出さない）。
- 後続 PR2 の ingest は、この account を `findChannelAccountCredentials(accountId,'discord')` で引いて使う。
