@AGENTS.md

# AgentPM スマホアプリ（apps/mobile）のルール

リポジトリ直下の `CLAUDE.md`（出力は日本語・TDD・ブランチ運用など）に加えて、ここを守る。
Web 用のルール（3ペイン・`bg-surface`・Next.js のページ速度レビュー等）はアプリには当てはまらない。

- **Expo のドキュメントはこの環境から読めないことがある**（docs.expo.dev が通信で止められる）。
  そのときは `node_modules/<パッケージ>/build/*.d.ts` の型定義で API を確かめる。記憶で書かない。
- **パッケージは `npx expo install` で入れる**。api.expo.dev に届かないときは `EXPO_OFFLINE=1 npx expo install …`。
- **DB への問い合わせは Web と同じ表・同じ条件で書く**（`src/api/`）。Web 側の対応箇所をコメントに書く。
  見える範囲は RLS が決める。アプリ側で絞っても安全にはならない。
- **Web のロジックは複製せず `@/…` で共有する**（`@/lib/tasks/myTaskViews` など）。共有してよいのは
  React・Next.js・ブラウザに依存しないファイルだけ。共有先を変えたら `npx expo export --platform ios` で
  まとめられるか確かめる。
- **Web ではサーバーが副作用を足している操作は、アプリから出さない**。例: 相手先にボールを渡すと
  `/api/portal/notify-approval` が承認依頼メールを送る。そのサーバーはブラウザの Cookie でしか呼べないので、
  アプリから同じ DB 操作をするとメールが届かない。アプリ用の認証（Bearer トークン）を足すまでは Web に任せる。
- **`rpc_pass_ball` は担当者を入れ替える**。ボールだけ変えるときも、今の担当者を全員渡す（`src/lib/owners.ts`）。
- **古い版が残る前提で変える**。DB の列名・RPC の引数を変えるときは、古い版のアプリが壊れないか考え、
  壊れるなら `src/lib/mobile/version.ts`（Web 側）の最低の版を上げる手順を踏む。
- **AsyncStorage（暗号化されない）にトークンを書かない**。ログイン情報は SecureStore
  （`src/lib/chunkedStorage.ts`）。react-query の取り置きは AsyncStorage に書かれるので、キーにも値にもトークンを入れない。
  キーには必ず userId を入れる（同じ端末で別の人がログインしたとき、前の人の取り置きを出さない）。
- **2段階認証の段階は問い合わせにしない**（`assuranceFromSession` でトークンから同期的に求める）。
  問い合わせにすると、トークン更新のたびに「確かめ中」へ戻り、開いている画面が閉じる。
- 色は `src/theme/colors.ts` のトークンだけを使う。相手先に見えるものは `clientVisible`（Web の Amber-500）。
- 出す前に `npm test`・`npm run typecheck`・`npm run lint` を通す。
