-- =============================================================================
-- タスク同期: 欠落コンテナ台帳(import_missing_containers)へ pendingConfig(設定待ち) を統合
--
-- 背景（このままだと壊れること）: 一部のコンテナが pendingConfig（マッピングウィザード等、
-- 運用側の設定未完了）で他のコンテナは成功したとき、接続共通のカーソル(poll_cursor)だけを
-- 現在時刻まで前進させていた。後でそのコンテナのマッピングを設定しても、設定待ちの間に存在した
-- レコードは前進済みのカーソルより過去になるため、以後更新されない限り永久に取り込まれない
-- （静かなデータ欠落）。当初は「欠落」(listContainers()に現れない。共有解除・削除等)と
-- 「未設定」(pendingConfig)を意図的に別概念として扱っていたが、必要な振る舞い（対象外と判明した
-- 時点のカーソル値を覚えておき、対象に戻ったらそこから取り直す）が同一であることが判明したため、
-- 既存の欠落台帳の仕組みへ統合する（src/lib/task-sync/engine.ts の MissingContainerMap 参照）。
--
-- 変更（列の型自体は変えない。jsonbはこの形をそのまま保存できるため列追加・型変更は不要）:
--   値の形を `{ containerId: "<カーソル値>" }` から
--   `{ containerId: { cursor: "<カーソル値>", reason: "missing" | "pending_config" } }` へ拡張する。
--   reason で「listContainers()に現れない(missing)」と「設定未完了(pending_config)」を区別し、
--   運用者がどちらの対応（相手側の削除/共有解除を確認する／マッピングを完了する）をすべきかを
--   判別できるようにする。
--
-- 後方互換: 本番DBの既存行（値が文字列そのものの旧形式。稼働中7アダプタ=Backlog/Jooto/Jira/
-- Redmine/Asana/Trello/Linearが既に書いている）は書き換えない（このmigrationはコメント更新のみ）。
-- アプリ側(src/lib/task-sync/runner.ts の parseStoredMissing)が読み取り時に旧形式(文字列値)を
-- reason='missing' として正規化し、次にその接続が成功パスで書き戻されるときに新形式へ
-- 自己修復される。
--
-- 適用: コメント更新のみ（列の型・デフォルト値は変更しない）。可逆（コメントを戻すだけ）。
-- =============================================================================

comment on column public.integration_connections.import_missing_containers is
  '取り込み対象コンテナのうち、直近で対象外だったものの欠落台帳。形は { containerId: { cursor: 対象外と判明した時点のpoll_cursor値(nullは空文字), reason: "missing"(listContainers()に現れない。共有解除・削除等) | "pending_config"(マッピング等の設定が未完了) } }。エンジン(src/lib/task-sync/engine.ts)が全available分の成功パスと同一updateで前進させる(service role専用。ユーザーが直接書く経路は無い)。対象に戻った(再共有された/マッピングが完了した)ときはこの記録値をsinceにして取り直し、取り切れたらエントリを削除する。これにより恒久削除・設定待ちのコンテナが残っていても他コンテナの取り込み・last_import_success_atの前進(=期限リマインドの鮮度証明)は凍結せず、かつ後から設定が完了したコンテナの取りこぼしも起きない。旧形式(値が文字列そのもの)の行はアプリ側で読み取り時にreason=missingとして正規化する(後方互換。書き換えマイグレーションは行わない)。';
