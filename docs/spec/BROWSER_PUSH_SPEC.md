# Browser Push Notifications (Web Push)

TaskApp の通知（`notifications` テーブル）をブラウザのネイティブ通知（Web Push API）として配信する機能。ブラウザを閉じていてもOS/ブラウザ側の仕組みで届く。メール通知とは独立した配信チャネルで、デバイス単位の購読。

## アーキテクチャ

```
notifications INSERT (channel='in_app')
  → DB trigger: notifications_push_dispatch
    → app_push_dispatch_hook() (SECURITY DEFINER)
      → net.http_post → POST /api/push/dispatch (Bearer CRON_SECRET)
        → push_subscriptions から to_user_id の購読を取得
        → web-push で各購読へ送信
        → 404/410 (失効) の購読は削除、成功した購読は last_used_at 更新
          → ブラウザの Service Worker (public/push-sw.js) が push イベントを受信
            → Notification 表示 → クリックでディープリンクへ遷移
```

トリガーは `net.http_post` を fire-and-forget で呼ぶのみで、送信結果を待たない。プッシュ送信の失敗（Vault未設定・pg_net無し・web-push側のエラー）が通知INSERT自体を失敗させることは無い。

## テーブル定義

`push_subscriptions`（`supabase/migrations/20260705234016_web_push_subscriptions.sql`）

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | `auth.users` 参照、cascade delete |
| endpoint | text | ブラウザのPush endpoint URL。unique（同一endpointへの重複購読を防ぐ） |
| p256dh | text | 購読の公開鍵 |
| auth | text | 購読の認証シークレット |
| user_agent | text \| null | デバッグ用 |
| created_at | timestamptz | |
| last_used_at | timestamptz \| null | 直近の送信成功時刻 |

RLS: `authenticated` は `user_id = auth.uid()` の行のみ select/insert/update/delete 可能。`service_role`（dispatch API）は RLS をバイパス。

## Vault Secrets（値はこのドキュメントに書かない）

- `push_dispatch_url` — `https://<domain>/api/push/dispatch`
- `cron_secret` — 既存の `/api/cron/client-reminders` と同じ値を再利用（Bearer認証）

## 環境変数

`.env.local.example` 参照。

| Variable | Notes |
|----------|-------|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | ブラウザに公開。`npx web-push generate-vapid-keys` で生成 |
| `VAPID_PRIVATE_KEY` | サーバーのみ。公開厳禁 |
| `VAPID_SUBJECT` | `mailto:` または `https://` 形式 |
| `CRON_SECRET` | `/api/push/dispatch` の認証（`/api/cron/client-reminders` と共用） |

## ロール別ディープリンク規則

`src/lib/push/buildPushMessage.ts` が通知の受信者ロール（`org_memberships.role`）とタスクの有無で遷移先を決める。

| Role | task_id あり | task_id なし |
|------|-------------|--------------|
| `client`（ポータル利用者） | `/portal/task/{task_id}` | `/portal` |
| それ以外（社内） | `buildTaskDeepLink(orgId, spaceId, taskId)` | `/inbox` |

通知タイプごとのタイトルは `buildPushMessage.ts` 内のマップを参照（例: `ball_passed` → 「ボールがあなたに渡されました」）。既存の `NotificationInspector.tsx` の種別ラベル（例:「ボール移動」）とは別物 — こちらはプッシュ通知のタイトルとしてアプリ外でも意味が通る文言にしている。

## 購読失効（自動削除）

`web-push.sendNotification` が `statusCode: 404 | 410` で失敗した購読は、ブラウザ側で購読が失効している（ユーザーが通知をブロック/ブラウザデータ削除等）ため、`push_subscriptions` から自動削除する。それ以外のエラーは `failed` カウントのみ増やし、購読は残す（再送で復帰する可能性があるため）。

## テスト手順

1. `npm test` — `buildPushMessage` / `urlBase64ToUint8Array` / `POST /api/push/dispatch` / `usePushNotifications` の単体テスト。
2. 実ブラウザ検証（手動）:
   - 設定画面（`/settings/notifications` または `/portal/settings`）で「ブラウザ通知」トグルをONにし、ブラウザの許可ダイアログを承認する。
   - `push_subscriptions` にレコードが作成されることを確認。
   - 任意の方法で `notifications` に `channel='in_app'` の行をINSERTし、ブラウザに通知が届くこと・クリックで正しいディープリンクへ遷移することを確認。
   - トグルをOFFにし、`push_subscriptions` から該当行が削除されることを確認。
