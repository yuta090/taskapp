# Google Chat 受信（共有アプリ）プロビジョニング手順（運用者向け）

Google Chat は他チャットと違い、**スペースでは @メンションされた時しか通常メッセージが届かない**ため、
「全発言を読んでタスクを拾う」には **Google Workspace Events API + Cloud Pub/Sub** でスペースを購読する
必要があります。コード（全6PR）は実装・本番ブランチ反映済みで、本書は**本番稼働に必要な運用者側の準備**を扱います。

```
[Chat app HTTP]  Google Chat ──@メンションの合言葉──▶ /api/channels/google-chat/webhook ──▶ グループ紐づけ(claim)
[Pub/Sub push]   購読成立後   ──全メッセージ──▶ Pub/Sub ──push──▶ /api/channels/google-chat/ingest ──▶ 記録(拾い)
[cron]           /api/cron/google-chat-subscriptions（毎10分）が「紐づけ済みグループに生きた購読がある」状態へ収束
```

## 設計の要点（Fable 裁定）
- **プラットフォーム集約**：当社の単一 GCP プロジェクト・単一 Chat アプリ・単一サービスアカウント(SA)・単一 Pub/Sub トピックで全 org 分を受ける（共通LINE と同型）。org 白ラベルは後続。
- **SA 鍵は DB に置かず env** で持つ。テナント分離は claim（`channel_link_codes.target_account_id` 束縛＋claim の org_id）だけが正。
- **claim = org帰属の正／subscription = 配送手段**。分離が背骨。購読が無い間は @メンションしか届かない＝構造的に沈黙。
- 受信2系統：(a) Chat app HTTP（@メンション合言葉で claim bootstrap）／(b) Pub/Sub push（購読後の全メッセージ）。
- 新規紐付けは **Pro 専有**（entitlements `external_chat_channels` / 上限 `maxExternalChatGroups`）。
- 各入口は **fail-closed**：env 欠落＝500／JWT不正・OIDC不一致＝401。

## A. GCP / Google Chat アプリ / Pub/Sub の用意（リードタイム最長・最優先）
1. **GCP プロジェクト**を1つ用意し、**プロジェクト番号**を控える。
2. **Chat API** と **Google Workspace Events API** を有効化。
3. **Google Chat アプリ（app）を構成**：
   - Connection settings = **App URL (HTTP endpoint)**。エンドポイント = `https://<本番>/api/channels/google-chat/webhook`。
   - **Authentication Audience = Project Number**（この設定により、受信 JWT の audience がプロジェクト番号になる。コードはこれを検証する）。
   - アプリを**インタラクティブ**にし、スペース追加・@メンションのイベントを受けられるようにする。
4. **サービスアカウント(SA)を作成**し、**鍵(JSON)**を発行（＝`GOOGLE_CHAT_SA_KEY`）。このSAがアプリの本体（発言・購読作成に使う）。
5. **Cloud Pub/Sub**：
   - トピックを1つ作成（フルリソース名 `projects/<proj>/topics/<topic>` を控える＝`GOOGLE_CHAT_PUBSUB_TOPIC`）。
   - **push サブスクリプション**を作成し、配信先 = `https://<本番>/api/channels/google-chat/ingest`。
   - push の認証に使う**サービスアカウントのメール**を控える（＝`GOOGLE_CHAT_PUSH_SA_EMAIL`）。push は OIDC トークンを付け、コードが issuer/audience/email/email_verified の4点を検証する。
   - Events API がこのトピックに publish できるよう、Workspace Events の service agent にトピックへの publish 権限を付与。
6. **Google Marketplace 配布**：自社ドメイン外の Workspace にアプリを入れるには、Marketplace への（限定 or 公開）掲載＋OAuth 検証プロセスが必要。**審査があり最も時間がかかる**ので、A の最初に着手する。

## B. 本番の環境変数（5つ・DBに鍵を置かない）
| env | 値 |
|-----|-----|
| `GOOGLE_CHAT_SA_KEY` | SA 鍵の JSON 文字列（`{client_email, private_key, ...}`） |
| `GOOGLE_CHAT_APP_PROJECT_NUMBER` | GCP プロジェクト番号（Chat app HTTP の JWT audience 検証に使用） |
| `GOOGLE_CHAT_PUSH_AUDIENCE` | Pub/Sub push の受信URL＝`https://<本番>/api/channels/google-chat/ingest`（OIDC audience 検証） |
| `GOOGLE_CHAT_PUSH_SA_EMAIL` | Pub/Sub push 用 SA のメール（OIDC email 検証） |
| `GOOGLE_CHAT_PUBSUB_TOPIC` | Pub/Sub トピックのフルリソース名（購読作成時 notificationEndpoint に渡す） |

いずれか欠落時は該当エンドポイントが **500 で fail-closed**（既知鍵で黙って通さない）。

## C. 本番DBのマイグレーション適用（`apply-migration.sh` ＋ `applied_migrations` 手動記録）
Google 側（A/B）が整うまで**適用不要**（未適用でも既存機能に影響なし・ランタイム未接続）。整ったら以下2枚を適用：
- `supabase/migrations/20260723152314_channel_event_subscriptions.sql`（購読状態テーブル＋RLS）
- `supabase/migrations/20260723171147_google_chat_subscription_cron.sql`（pg_cron 登録・vault 未設定なら no-op で安全）

## D. vault に cron の宛先を登録
- `cron_google_chat_subscriptions_url` = `https://<本番>/api/cron/google-chat-subscriptions`
- `cron_secret` は既存の共有シークレットを流用（cron は `Authorization: Bearer <cron_secret>` を付けて POST）。

## E. 共通アカウント（platform 行）を作る（service role で1回だけ）
```bash
# scripts/seed-platform-google-chat-account.mjs（冪等・既存があれば何もしない）
# credentials に秘匿鍵は入らない（SA 鍵は env）。SYSTEM_ENCRYPTION_KEY が必要。
SUPABASE_SERVICE_ROLE_KEY=... SYSTEM_ENCRYPTION_KEY=... node scripts/seed-platform-google-chat-account.mjs
```
`owner_type='platform'`・`channel='google_chat'`・`org_id=NULL` の行が1つできる。

## F. 実機で確認（1点）
- 購読作成（Workspace Events API）に **`chat.bot` スコープだけで通るか**、`chat.messages.readonly` 相当の追加スコープが要るかを実機確認。
  実装は安全側で両方要求している（`src/lib/channels/google-chat/client.ts` の `CHAT_EVENTS_SCOPE`）。通らなければここを調整。

## G. 顧客オンボーディング（接続画面がガイド）
接続画面（`/{orgId}/secretary/connect/google_chat`）が次の3ステップを案内する：
1. 当社の Google Chat アプリを対象スペースに追加。
2. **Workspace 管理者が権限を一度だけ承認**（これが無いと Events API の購読が張れない）。
3. 画面で合言葉を発行し、スペースで **@bot をメンションして**投稿。承認後に会話の記録が始まる。

## 検証（本番稼働後）
- 新規スペースで合言葉を @bot 投稿 → 承認コンソールに pending が現れ、承認でグループが紐づく。
- 紐づけ後、cron（毎10分）で `channel_event_subscriptions` に `status='active'` 行ができる。
- スペースで通常発言 → `channel_messages` に group_id 付きで記録される（拾い成立）。
- 「完了N」で申し送りタスクが完了、朝のまとめ報告がスペースに届く（platform は SA 送信）。
- 未紐づけスペースでは、合言葉以外の @メンションは記録0・発話0（沈黙）。

## 縮退・自己修復
- 購読は TTL で失効するが、cron が「紐づけ済みで購読が無い/切れそう」を毎回検出して張り直す（失効＝永久削除でも「次の cron で再購読」に落ちる）。
- アプリ除去・承認取消などの恒久エラーは `status='broken'`（拾いは止まるが、記録・digest・完了は壊さない）。
