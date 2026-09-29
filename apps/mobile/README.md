# AgentPM スマホアプリ（iPhone / Android）

Expo（React Native）で作った、AgentPM の社内メンバー向けスマホアプリ。
Web と同じ Supabase・同じ RLS をそのまま使う（アプリ用のサーバーは無い）。

## できること（第1弾）

| 画面 | 内容 |
|---|---|
| ログイン | メールアドレス＋パスワード、または Google（Web と同じアカウント）。2段階認証（TOTP）にも対応 |
| マイタスク | 自分が担当の「いま手を付けるもの」を期限別に。ボール（自分たちの番／相手先の番）で絞れる |
| タスク詳細 | 状態の切り替え・ボールを相手先に渡す／自分たちに戻す・社内承認の承認と差し戻し・コメント |
| 受信トレイ | 通知の一覧・既読・タップでタスクへ |
| アカウント | 組織の切り替え・Web 版を開く・ログアウト |
| プッシュ通知 | 受信トレイに届く通知のうち、相手を待たせるものをスマホに鳴らす。タップでそのタスクを開く |

Web でやること: ガント・Wiki・議事録・設定（通知の種類のオン・オフもここ）・お支払い、担当者の変更、新規登録・パスワード再設定。

### Web のサーバー API を呼ぶ

Web と同じく、次の操作ではサーバーの API も呼ぶ（アプリのアクセストークンを Bearer で付ける。
サーバー側は `src/lib/supabase/routeAuth.ts`。Bearer を受け付けるのはこの2つだけ）。

- 相手先にボールを渡す → 承認依頼メール（`/api/portal/notify-approval`）。送れなくてもボールは戻さない（Web と同じ）
- ボールの移動・状態の変更・「相手先にも見える」コメント → Slack への知らせ（`/api/slack/notify`）

## プッシュ通知

- 鳴らす条件は Web のブラウザ通知と同じ（`src/lib/notifications/delivery.ts`）: 相手を待たせる種類だけ・夜21時〜朝8時と土日は鳴らさない（至急は例外）・1日の上限・本人の設定
- 流れ: 通知が DB に入る → トリガーが Web の `/api/push/dispatch` を呼ぶ → ブラウザ（Web Push）とアプリ（Expo のプッシュ API）に送る
- 宛先は `mobile_push_tokens`（`supabase/migrations/*_mobile_push_tokens.sql`）。登録は RPC `rpc_register_mobile_push_token` だけ
  （2段階認証を通すまで登録できない・同じ端末を別の人が使ったら宛先を移す）。ログアウトの前に自分の行を消す
- 相手先（client）の人にはアプリへ送らない（アプリは社内向け）

### 動かすための準備（1回だけ）

1. `npx eas-cli@latest init` で EAS のプロジェクトを作る（`app.json` に `extra.eas.projectId` が入る。無いと通知の登録を飛ばす）
2. iOS: `eas credentials` で APNs の鍵を登録（Apple Developer 登録が要る）
3. Android: Firebase で `google-services.json` を作り、FCM の鍵を `eas credentials` で登録
4. Web（Vercel）の環境変数に `EXPO_ACCESS_TOKEN`（Expo の「Enhanced push security」のトークン）を入れる（任意だが本番では推奨）
5. migration `*_mobile_push_tokens.sql` を本番 DB に当てる
6. 通知は Expo Go ではなく開発ビルド（`eas build --profile development`）の実機で試す（シミュレーターには届かない）

既知の穴:
- 送った後の「受領確認」は見ていない（アプリを消した端末の宛先が、送信時にエラーにならない限り残る）
- 自分でログアウトせずに切れた場合（ログインの期限切れ・他の端末からの全端末ログアウト）は、アプリが
  `/api/mobile/push-token/unregister` に端末のトークンを渡して宛先を外す（トークンを持っていることが証明）。
  アプリが開かれないまま切れた場合は、次にアプリを開くまで外れない

## Google ログインの準備（1回だけ）

- Supabase の管理画面 → Authentication → URL Configuration → **Redirect URLs** に `agentpm://auth/callback` を足す
  （足さないと、Google から Web のトップに戻ってしまいアプリに戻らない）
- Expo Go で試すときは戻り先が `exp://…/--/auth/callback` になるので、開発中だけそれも足す（開発版アプリなら不要）

## ビルド（EAS）

- `eas.json` に3つ: `development`（開発版アプリ・社内配布）/ `preview`（社内配布）/ `production`（ストア提出）
- 環境変数（`EXPO_PUBLIC_SUPABASE_URL` など）は `.env.local` ではなく EAS の環境変数に入れる（`eas env:create`）

## 動かし方

```bash
cd apps/mobile
npm install
cp .env.example .env.local   # Supabase の URL・anon key を埋める（ルートの .env.local の NEXT_PUBLIC_* と同じ値）
npx expo start               # 表示された QR コードを iPhone のカメラ / Android の Expo Go で読む
```

## 確認

```bash
npm test            # 画面を持たないロジック（src/lib）のテスト
npm run typecheck
npm run lint
```

## つくり

- `src/app/` … 画面（Expo Router。ファイル＝画面）
- `src/api/` … Supabase への問い合わせ。**Web と同じ表・同じ条件**で書く（見える範囲は RLS が決める）
- `src/hooks/` … 画面が使う読み書き（react-query）。読んだデータは端末に取り置き、次に開いたとき即表示する
- `src/lib/` … 画面を持たない純粋なロジック（テストあり）
- `@/…` はリポジトリ直下の `src/`（Web）を指す。マイタスクの並べ方・通知の文面・RPC の呼び方は Web のものをそのまま使う
  （`metro.config.js` と `tsconfig.json` で設定）。アプリ自身のコードは `~/…`

## 古い版への備え

ストアのアプリは古い版を使い続ける人がいる。起動時に Web の `/api/mobile/version` から
「対応している最低の版」をもらい、古ければ更新をお願いする画面にする。
DB の形を変えて古い版が壊れるときは、直した版をストアに出してから `src/lib/mobile/version.ts`（Web 側）の版を上げる。
