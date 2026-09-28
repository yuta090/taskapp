# AgentPM スマホアプリ（iPhone / Android）

Expo（React Native）で作った、AgentPM の社内メンバー向けスマホアプリ。
Web と同じ Supabase・同じ RLS をそのまま使う（アプリ用のサーバーは無い）。

## できること（第1弾）

| 画面 | 内容 |
|---|---|
| ログイン | メールアドレス＋パスワード（Web と同じアカウント）。2段階認証（TOTP）にも対応 |
| マイタスク | 自分が担当の「いま手を付けるもの」を期限別に。ボール（自分たちの番／相手先の番）で絞れる |
| タスク詳細 | 状態の切り替え・ボールを自分たちに戻す・社内承認の承認・コメント |
| 受信トレイ | 通知の一覧・既読・タップでタスクへ |
| アカウント | 組織の切り替え・Web 版を開く・ログアウト |

Web でやること: ガント・Wiki・議事録・設定・お支払い、相手先にボールを渡す、差し戻し、Google ログイン。

### 既知の差（Web との違い）

Web のサーバー API（`/api/slack/notify`・`/api/portal/notify-approval`）はブラウザのログイン（Cookie）でしか
呼べないため、アプリからの操作では次が起きない。受信トレイの通知は DB 側で作られるので届く。

- 「相手先にも見える」コメント・ボールの移動の **Slack への知らせ**
- 相手先にボールを渡したときの **承認依頼メール**（そのため相手先に渡す操作自体をアプリに出していない）

アプリのトークン（Bearer）を受け付けるサーバー経路を足せば解消できる。認証の入口を増やす設計なので別途決める。

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
