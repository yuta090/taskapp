# 通知の届き方（運用メモ）

通知を「その場で届ける / 1日1回のまとめに回す / 送らない」のどれにするかは
**`src/lib/notifications/delivery.ts` が正本**。画面・メール・プッシュのどれもここを見る。

判断の軸はひとつだけ — **受け取る人が動かないと、誰かが待って止まるか**。

## 経路は3つ

| 経路 | いつ動くか | 何が届くか |
|---|---|---|
| アプリ内（受信箱・ベル） | 通知が生まれた瞬間 | 全部 |
| ブラウザ通知（プッシュ） | 通知が生まれた瞬間（DBトリガ → `/api/push/dispatch`） | 「待たせている」種類だけ |
| メール（即時） | 5分ごと（`/api/cron/notification-immediate`） | 「待たせている」種類だけ・1通にまとめて |
| メール（まとめ） | 毎朝8時 JST（`/api/cron/notification-digest`） | 即時で送っていない残り全部 |

**アプリ内には必ず残る。** 鳴らさない・送らないと判断しても、受信箱から消えることはない。

## 歯止め

- **静かな時間帯**: JST 夜21時〜翌朝8時 と 土日は、プッシュも即時メールも出さない。
  例外は `urgent_confirmation`（至急の確認）だけ。止めたぶんは翌朝のまとめで届く
- **1日の上限**: プッシュは1人1日 `PUSH_DAILY_CAP`(=10) 件まで。超えたぶんは受信箱と翌朝のまとめに残る
- **二重送信の防止**: 即時メールで送った通知には `notifications.immediate_email_sent_at` が立ち、
  毎朝のまとめはその行を外す。**「送る予定だった」ではなく「実際に送った」で記録する**ので、
  夜間に止めたぶんはちゃんとまとめで届く
- **さかのぼる範囲**: 即時ワーカーは直近15分ぶんだけを見る。これが無いと、
  夜のあいだにたまった通知を朝8時の1回目で全部送ってしまい、同じ8時のまとめと二重になる

## 受信設定

`notification_email_prefs`（本人1行・RLS）。**行が無い＝設定を一度も触っていない人は「オン・毎日」の既定**として扱う。
設定画面は行が無くても「オン」と表示するので、配信側が行の有無で判断すると
「オンに見えるのに届かない」になる（2026-09 に本番で発生。行数0件で誰にも届いていなかった）。

既定値は `DEFAULT_NOTIFICATION_EMAIL_PREFS`（配信側）と `DEFAULT_EMAIL_PREFS`（画面側）の
2か所にあり、一致することを `digest.test.ts` が検査する。

`digest_frequency = 'none'` と `email_enabled = false` は、まとめだけでなく**即時メールも止める**（本人のオフスイッチ）。

## cron の設定（本番）

URL とシークレットは Vault から読む。**新しい環境では手動で1回だけ**登録が要る。

```sql
select vault.create_secret('https://agentpm.app/api/cron/notification-digest',   'cron_notification_digest_url');
select vault.create_secret('https://agentpm.app/api/cron/notification-immediate','cron_notification_immediate_url');
select vault.create_secret('https://agentpm.app/api/push/dispatch',              'push_dispatch_url');
-- cron_secret は他のcronと共用
```

登録済みか確認:

```sql
select name from vault.secrets where name like 'cron_notification%' or name = 'push_dispatch_url';
select jobname, schedule, active from cron.job where jobname like 'notification-%';
```

## 動作確認

```bash
# 送らずに「誰に何件送る予定か」だけ見る
curl -X POST "https://agentpm.app/api/cron/notification-immediate" \
  -H "Authorization: Bearer $CRON_SECRET" -H 'Content-Type: application/json' \
  -d '{"dryRun":true}'

# 宛先を自分に固定して1通だけ実際に送る（印は付かない＝本番データを汚さない）
curl -X POST "https://agentpm.app/api/cron/notification-digest" \
  -H "Authorization: Bearer $CRON_SECRET" -H 'Content-Type: application/json' \
  -d '{"recipientOverride":"you@example.com"}'
```

夜間・休日に叩くと `{"skipped":"quiet_hours"}` が返る（仕様どおり）。

## 種類を増やすとき

1. `src/lib/notifications/labels.ts` に日本語名を足す
2. `src/lib/notifications/delivery.ts` に配信ポリシーを1行足す
3. まとめに載せるなら `digest.ts` の `TYPE_TO_CATEGORY` にも足す

1と2の漏れは `delivery.test.ts` が、3の漏れは同テストの「見出しを必ず持つ」検査が落として教えてくれる。
