# チャネル配管 Stage 1 実装仕様（AI秘書の背骨）

> **Status**: 実装済み（LINE受信・送信・突合・添付保存・redaction機構）
> **Last Updated**: 2026-07-10
> **設計正本**: `docs/spec/AI_SECRETARY_DESIGN_v0.1.md`（§2 背骨=messagesログ / §8 WoZの範囲）
> **Migration**: `supabase/migrations/20260710204722_channel_plumbing.sql`

AI秘書（回収・催促・証跡エンジン）の配管層。頭脳（文面生成・催促判断）は先行5事務所フェーズでは人力（Wizard of Oz）だが、**メッセージがシステムを通らないとログ・証跡・カルテという売り物の核が成立しない**ため、配管を先行実装した。

## 1. テーブル（4表 + Storage）

| テーブル | 役割 | RLS |
|---------|------|-----|
| `channel_accounts` | 事務所ごとのチャネル資格情報（白ラベル=事務所ごとにLINE公式アカウント）。credentials は `encrypt_system_secret`(pgcrypto) で暗号化 | **authenticatedポリシー無し**（service roleのみ） |
| `channel_identities` | 顧問先連絡先⇔チャネル外部ID(LINE userId等)の紐付け。**DELETE禁止**（トリガーで拒否・revokeのみ） | 読取=内部メンバー / 書込=service role |
| `channel_link_codes` | 突合コード（8桁英数・30日・**期限内マルチユース**） | 同上 |
| `channel_messages` | **背骨のログ（真実の源）**。append-onlyをトリガーで強制 | 同上 |
| Storage `channel-attachments` | 添付実体（非公開・objectsポリシー無し） | service roleのみ |

### channel_messages の不変条件（トリガー `channel_messages_guard_update`）

- 内容列（body/payload）は変更不可。唯一の例外は **redaction遷移**（`rpc_redact_channel_message` 経由）
- 帰属（space_id / identity_id）は **NULL→値の一方向のみ**（突合後のバックフィル用）
- storage_path は NULL→値のみ（添付の後追いリトライ用）。除去はredactionのみ
- redaction は取り消し不可
- dedupe: unique(org_id, channel, external_message_id)。LINEは `message.id` を使う（webhook再送でも不変）

### 同一人物×複数顧問先

unique は `(org_id, channel, external_id, space_id) where status='active'` の partial index。社長が2法人経営・経理代行が複数社担当するケースを許容する。inbound の帰属は active identity が**1件のときだけ自動確定**、複数件は space_id NULL のまま人力トリアージ（WoZ期は許容）。

## 2. フロー

### 受信（webhook）

```
POST /api/channels/line/webhook
  1. 生ボディから destination(=bot userId) だけ取り出す（未検証ボディを他用途に使わない）
  2. channel_accounts を destination で逆引き → 不明なら 200 ignored（再送ループ防止）
  3. アカウント別 channel_secret で署名検証 → 不正は 401
  4. イベント処理（1イベントの失敗は他を巻き込まない）
     - text: リンクコード形式なら突合処理。それ以外は inbound 記録
     - image/file/video/audio: LINE content API から即時取得 → Storage保存
       （LINE側は期限で消えるため受信時保存が必須。失敗は status='failed'+error でリトライ可能）
     - follow: system記録 + 挨拶push（AI名乗り・「記録に残ります」は§9の固定文言）
     - unfollow: system記録
```

### 突合（顧問先ロールアウト §7）

1. 事務所が `POST /api/channels/link-codes` {orgId, spaceId} でコード発行（内部メンバーのみ）
2. 顧問先へ事務所名義の案内（メール雛形・請求書同封の紙/QR）でコードを渡す
3. 顧問先が友だち追加 → 挨拶メッセージがコード返信を促す → トークにコード送信
4. webhookが突合: 他orgのコードは無効。成立で identity 作成＋確認メッセージ返信＋往復とも記録

### 送信（WoZ期の秘書名義送信）

```
POST /api/channels/messages {orgId, spaceId, text}
  - 内部メンバーのみ（org_memberships role in owner/admin/member）
  - active identity 無し → 409（未突合）
  - 証跡が先・送信が後: queuedで記録 → push(retryKey=行id、二重配信防止) → sent/failed更新
  - actor='secretary', sent_by=操作した職員のuserId（誰が秘書名義で送ったかの証跡）
```

## 3. マイナンバー等の機微情報（redaction）

bodyや添付に機微が届くこと自体は防げない。**行DELETEは証跡を壊すため、中身だけ破壊して墓標を残す**:

- `rpc_redact_channel_message(message_id, redacted_by, reason)` — service roleのみ実行可
- body→固定プレースホルダ、payload→{}、storage_path→NULL、redacted_at/by/reason を記録
- **呼び出し側の義務**: RPCの前に Storage の添付実体を admin storage API で削除すること（bodyだけ消して画像に番号が写っている、が最悪パターン）
- UI は Stage 2（機構のみ先行）

## 4. 運用

### アカウント登録（事務所のLINE公式アカウント接続）

LINE Developers コンソールで Messaging API チャネルを作成し、service role で登録:

```sql
insert into channel_accounts (org_id, channel, line_bot_user_id, display_name, credentials_encrypted)
values (
  '<org uuid>',
  'line',
  '<bot userId (Uで始まる。webhook検証イベント or チャネル基本設定で確認)>',
  '<白ラベル秘書の表示名（例: 山田会計事務所）>',
  encrypt_system_secret(
    '{"channel_secret":"<channel secret>","access_token":"<long-lived channel access token>"}',
    '<SYSTEM_ENCRYPTION_KEY>'
  )
);
```

Webhook URL は LINE コンソールに `https://agentpm.app/api/channels/line/webhook` を設定（全事務所共通の単一エンドポイント。destinationで振り分け）。

### 環境変数

新規キーは不要（既存の `SYSTEM_ENCRYPTION_KEY` を使用）。資格情報はDB管理。

## 5. Stage 2 以降（未実装）

- 送信UI（WoZオペレータコンソール: spaceタイムライン＋送信ボックス）— APIは実装済み
- メール/Chatwork/Slack/Google Chat アダプタ（`channel` 列・抽象は対応済み）
- 層2アクショントークン（email-action の一般化）・アップロード等のアクションページ
- redaction UI / 添付failedの自動リトライ / link_codeブルートフォースのレート制限
- unfollow時のidentity自動revoke（現状はログのみ・手動revoke）

## 6. 検証項目（migration適用後にservice roleで実施）

1. webhook再送（同一 message.id）で行が増えない
2. 署名不正がアカウント逆引き後に必ず401
3. 他orgのauthenticatedで channel_messages / channel_identities が0行。channel_accounts は同orgでも読めない
4. body直接UPDATEがservice roleでも拒否され、redaction RPC経由のみ通る
5. space_id NULL→値は通り、値→別値は拒否
6. channel_identities の DELETE が拒否される
7. 添付: 受信→Storage保存→LINE側期限切れ後もダウンロード可能
8. link_code: 期限内2人目の突合が成功、期限後・他orgは拒否
