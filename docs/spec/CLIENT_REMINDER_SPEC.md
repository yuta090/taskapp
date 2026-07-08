# クライアント滞留リマインドメール 仕様書

> **Version**: 1.0
> **Last Updated**: 2026-07-05
> **Status**: 実装済み

## 概要

ボールがクライアント（`role='client'` の認証ユーザー）にあるタスクが滞留し続ける問題を防ぐため、
1日3回、受信者ごとに1通のダイジェストメールで対応待ちタスクを通知する。

## 対象タスク

```
ball = 'client' AND status <> 'done' AND client_scope = 'deliverable'
```

`client_scope = 'internal'`（クライアントに見せない内部タスク）は対象外。

## 分類ルール（1タスクは1分類のみ）

| 分類 | 条件 | 送信スロット |
|------|------|--------------|
| `overdue` | `due_date` が今日(JST)より過去 | 全スロット（1日最大3回） |
| `due_today` | `due_date` が今日(JST) | slot 0 のみ |
| `stalled` | 期限なし、または未来の期限。`ballSince` から72時間以上経過 | slot 0 のみ |

どれにも該当しないタスクは通知しない。`ballSince` は `task_events` の
`action='PASS_BALL'` かつ `payload->>'ball'='client'` の最新 `created_at`。
該当イベントが無ければ `tasks.updated_at` にフォールバックする。

## スロット

pg_cron が JST 9時・13時・17時（UTC 0時・4時・8時）に実行する。JST時刻からの算出:

- `hour < 12` → slot 0
- `12 <= hour < 16` → slot 1
- `hour >= 16` → slot 2

JST日付・時刻は `toISOString()` を使わず `Intl.DateTimeFormat`（`timeZone: 'Asia/Tokyo'`）で算出する
（プロジェクト規約: `toISOString()` は日本時間で1日ずれる実害があるため使用禁止）。

## 配信経路

```
pg_cron（0 0,4,8 * * *）
  → app_invoke_client_reminders()（SECURITY DEFINER, Vault からURL/シークレット取得）
  → pg_net.http_post（Authorization: Bearer <CRON_SECRET>）
  → POST /api/cron/client-reminders
  → computeClientReminders()（純粋関数, src/lib/reminders/computeClientReminders.ts）
  → 受信者ごとに sendReminderEmail()（Resend, src/lib/email/reminder.ts）
  → client_reminder_log へ記録
```

## 重複防止（dedupe）

`client_reminder_log (task_id, recipient_user_id, kind, sent_on, slot)` に一意制約があり、
同一タスク・受信者・分類・日付(JST)・スロットの組み合わせは1回しか送らない。
送信ループは `Promise.allSettled` で各受信者を独立に処理し、1通の送信失敗が他の受信者への
送信やログ記録を止めない。

## オプトアウト

`profiles.reminder_emails_enabled`（デフォルト `true`）。ポータル設定画面
（`/portal/settings`）の「リマインドメール」トグルで変更できる。楽観的更新（保存ボタン無し）。
`false` のユーザーは対象タスクがあってもダイジェストの生成対象から除外される。

## 受信者解決

1. `task_owners`（`side='client'`）に登録があればそれを使う。
2. 登録が無ければ、そのタスクが属する `space_memberships`（`role='client'`）の全員にフォールバック
   （`src/app/api/portal/notify-approval/route.ts` と同じ方針）。
3. メールアドレスは `auth.admin.getUserById()` で解決する（`profiles` に email 列は無い。
   select に含めるとクエリ全体が失敗しオプトアウトまで無視されるので含めないこと）。

## API: `POST /api/cron/client-reminders`

- 認証: `Authorization: Bearer <CRON_SECRET>`。ヘッダ不一致は401、`CRON_SECRET` 未設定は500。
- パラメータ（クエリまたはJSONボディ）:
  - `dryRun=true` — 送信・ログ記録を行わず、計画（`plan`: 受信者ごとのダイジェスト）を返す。
  - `recipientOverride=<email>` — 動作確認用。全ダイジェストをこのアドレス宛に送信し、
    **`client_reminder_log` への記録はスキップする**（本来の受信者の送信済み扱いにならない）。
- レスポンス: `{ todayJst, slot, digestCount, emailsSent, tasksNotified, errors }`
  （`dryRun` 時は `dryRun: true, plan: [...]` を追加）。

## 環境変数

| 変数 | 用途 |
|------|------|
| `CRON_SECRET` | cron APIのBearer認証シークレット。Supabase Vaultの `cron_secret` と同値にする |
| `RESEND_API_KEY` / `FROM_EMAIL` | 既存のメール送信基盤（承認メールと共通） |
| `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_APP_NAME` | メール内リンク・件名に使用 |

## 関連ファイル

```
src/lib/reminders/computeClientReminders.ts   # 分類・スロット・dedupeの純粋関数
src/lib/email/reminder.ts                     # sendReminderEmail（Resend送信）
src/lib/email/templates/ReminderEmail.tsx     # React Email テンプレート
src/lib/hooks/useReminderPreference.ts        # ポータル設定トグルの楽観的更新フック
src/app/api/cron/client-reminders/route.ts    # cron エントリポイント
supabase/migrations/20260705220354_client_reminder_emails.sql
```
