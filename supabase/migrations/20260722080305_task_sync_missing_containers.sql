-- =============================================================================
-- タスク同期: 明示指定コンテナの欠落台帳（恒久的な催促停止の回帰防止）
--
-- 背景（このままだと壊れること）:
--   直前の migration/実装で「明示指定した取り込み対象コンテナが listContainers() に現れない
--   （Notionで共有解除・Backlogでプロジェクト削除等）とき、そのコンテナ分の欠落を無視して
--   カーソルを前進させない」対策を入れた。取りこぼしは防げるが、**恒久的に削除されたコンテナが
--   1つでも残っていると、その接続の poll_cursor / last_import_success_at が永久に前進しない**。
--   last_import_success_at は src/lib/reminders/dueReminderStaleness.ts が期限リマインドの
--   鮮度判定に使う列であり、これが凍結すると**その接続配下の全タスクの催促が無言で恒久停止する**。
--   稼働中7アダプタ（Backlog/Jooto/Jira/Redmine/Asana/Trello/Linear）がこのカーソル制御を
--   共有しているため、顧客がプロジェクトを1つ削除するだけで発火し得る本番回帰だった。
--
-- 対策（設計は fable-architect 裁定済み。変更しない）:
--   このエンジンのカーソルは provider の不透明トークンではなく、エンジン自身が
--   advanceCursor(granularity, now) で作る時刻ベースの値（src/lib/task-sync/cursor.ts）。
--   よって「コンテナが欠落と判明した時点で有効だったカーソル値」さえ覚えておけば、
--   再出現時にそのコンテナだけ記録値を since にして取り直すことで取りこぼしを完全に閉じられる。
--   利用可能なコンテナの取り込みは毎サイクル前進し続けるので、恒久削除が残っていても
--   鮮度証明が凍結しなくなる（重複取得は unique(connection_id, external_id) により無害）。
--
-- 形: { "<containerId>": "<欠落判明時点で有効だった poll_cursor 値。null だった場合は空文字
--      （''）=再出現時フルフェッチを意味する>" }。値はエンジン(src/lib/task-sync/engine.ts)が
--   計算し、store.ts の saveCursor / saveMissingContainers が **成功パスと同一 update** で書く
--   （poll_cursor / last_import_success_at と同じトランザクション性を保つため）。
--
-- 適用: additive な列追加のみ。default '{}'::jsonb のため既存行の書き換えを伴わず稼働中に
--   適用できる。ロールバックは列 drop で可逆（この台帳はエンジンの再計算専用でありユーザー入力を
--   保持しないため、削除しても取り込み自体は継続できる＝次回サイクルで空扱いから再構築される）。
--
-- RLS: この列は integration_connections の既存ポリシー配下にそのまま乗る。書き込みは
--   ワーカー（service_role。RLSをバイパス）の成功パス（store.ts の saveCursor /
--   saveMissingContainers）でのみ行う契約であり、新たな境界は増えない
--   （既存の「users can update own connections」ポリシーは自分の接続の他列も更新可能な設計で、
--   この列だけを追加保護する理由がない＝ poll_cursor 等と同じ扱い）。ポリシー変更は不要。
-- =============================================================================

alter table public.integration_connections
  add column if not exists import_missing_containers jsonb not null default '{}'::jsonb;

comment on column public.integration_connections.import_missing_containers is
  '明示指定した取り込み対象コンテナのうち、直近で listContainers() に現れなかったものの欠落台帳。形は { containerId: 欠落判明時点の poll_cursor値(nullは空文字) }。エンジン(src/lib/task-sync/engine.ts)が全available分の成功パスと同一updateで前進させる(service role専用。ユーザーが直接書く経路は無い)。再出現時はこの記録値をsinceにして取り直し、取り切れたらエントリを削除する。これにより恒久削除コンテナが残っていても他コンテナの取り込み・last_import_success_atの前進(=期限リマインドの鮮度証明)は凍結しない。';
