-- 業種プリセットに同梱するサンプルタスクを判別するための列
-- - オンボーディング直後の着地画面を「生きた状態」にするため、プリセット適用時にサンプルタスクを数件INSERTする
-- - is_sample=true のタスクは一覧上でバッジ表示し、一括削除の対象にできる
--
-- 適用: psql 個別実行 + applied_migrations へ INSERT（docs/db/MIGRATION_AUDIT_2026-07-05.md 参照）

alter table public.tasks
  add column if not exists is_sample boolean not null default false;

comment on column public.tasks.is_sample is 'プリセット同梱のサンプルタスクか（true=サンプル、ユーザーが一括削除できる）';
