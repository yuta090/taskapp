@AGENTS.md

# AgentPM スマホアプリ（apps/mobile）のルール

リポジトリ直下の `CLAUDE.md`（出力は日本語・TDD・ブランチ運用など）に加えて、ここを守る。
Web 用のルール（3ペイン・`bg-surface`・Next.js のページ速度レビュー等）はアプリには当てはまらない。

- **押したらすぐ出す（アプリ全体の方針・2026-10-01 ユーザー指定）**。遅いアプリは使われない。
  - 画面を開くのに通信を待たせない。一覧が持っているデータで先に描き、足りない分だけ裏で読む（`placeholderData`・取り置き）。
  - 一覧→詳細は、一覧が持っているデータで先に描く（`useTaskDetail` はマイタスクとプロジェクトのタスクの取り置きを見る）。
    行を押す前から先読みする（`onPressIn` で `prefetchQuery`）。
  - 全画面の `Loading` を出してよいのは、手元に何も無いときだけ。
  - 書き込みは先に画面へ反映し、失敗したら戻す（保存ボタンなし）。
  - 画面の移動はネイティブの Stack（右からスライド）。JS で作ったアニメーションや、モーダルで代用しない。
  - 長い一覧は FlashList。
  - 新しい画面を足したら、機内モードでも前回の内容がすぐ出るかを確かめる。
- **Expo のドキュメントはこの環境から読めないことがある**（docs.expo.dev が通信で止められる）。
  そのときは `node_modules/<パッケージ>/build/*.d.ts` の型定義で API を確かめる。記憶で書かない。
- **パッケージは `npx expo install` で入れる**。api.expo.dev に届かないときは `EXPO_OFFLINE=1 npx expo install …`。
- **DB への問い合わせは Web と同じ表・同じ条件で書く**（`src/api/`）。Web 側の対応箇所をコメントに書く。
  見える範囲は RLS が決める。アプリ側で絞っても安全にはならない。
- **`spaces` を埋め込むときは外部キー名を書く**（例 `spaces!tasks_space_id_fkey(name)`）。tasks など12表は spaces への
  外部キーが2本あり、書かないと本番で PGRST201 になる。番人は Web 側の `src/__tests__/lib/supabase/spaceEmbedHint.test.ts`。
- **Web のロジックは複製せず `@/…` で共有する**（`@/lib/tasks/myTaskViews` など）。共有してよいのは
  React・Next.js・ブラウザに依存しないファイルだけ。共有先を変えたら `npx expo export --platform ios` で
  まとめられるか確かめる。
- **Web ではサーバーが副作用を足している操作は、アプリでも同じサーバー API を呼ぶ**（`src/api/webApi.ts`。
  アクセストークンを Bearer で付ける）。サーバー側で Bearer を受け付けるのは `createRouteAuth`
  （`src/lib/supabase/routeAuth.ts`）を使うルートだけ。新しく呼ぶルートは、そのルートを `createRouteAuth` に
  切り替えて、2段階認証の確認に `accessToken` を渡す（渡さないと登録者が必ず弾かれる）。
- **Wiki の本文（`wiki_pages.body`）は BlockNote の JSON 文字列で、Markdown ではない**。読むのは `src/lib/wikiBody.ts`（`parseWikiBody`）。
  新しいブロックの型は Web のエディタに足したら、ここにも対応を足す（未対応は文字だけ出る）。
- **`rpc_pass_ball` は担当者を入れ替える**。ボールだけ変えるときも、今の担当者を全員渡す（`src/lib/owners.ts`）。
- **古い版が残る前提で変える**。DB の列名・RPC の引数を変えるときは、古い版のアプリが壊れないか考え、
  壊れるなら `src/lib/mobile/version.ts`（Web 側）の最低の版を上げる手順を踏む。
- **AsyncStorage（暗号化されない）にトークンを書かない**。ログイン情報は SecureStore
  （`src/lib/chunkedStorage.ts`）。react-query の取り置きは AsyncStorage に書かれるので、キーにも値にもトークンを入れない。
  キーには必ず userId を入れる（同じ端末で別の人がログインしたとき、前の人の取り置きを出さない）。
- **2段階認証の段階は問い合わせにしない**（`assuranceFromSession` でトークンから同期的に求める）。
  問い合わせにすると、トークン更新のたびに「確かめ中」へ戻り、開いている画面が閉じる。
- **プッシュ通知の宛先の登録は RPC（`rpc_register_mobile_push_token`）だけ**。`mobile_push_tokens` に直接 insert しない
  （権限を渡していない）。鳴らす条件はサーバー（`/api/push/dispatch`）が Web と共通で決める。アプリ側で条件を足さない。
- 色は `src/theme/colors.ts` のトークンだけを使う。相手先に見えるものは `clientVisible`（Web の Amber-500）。
- 出す前に `npm test`・`npm run typecheck`・`npm run lint` を通す。
