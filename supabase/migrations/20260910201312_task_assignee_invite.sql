-- 招待中（まだ承諾していない）の人をタスクの担当者にできるようにする。
--
-- これまで担当者は assignee_id（auth.users）だけで、アカウントが無い＝招待中の人は担当にできず、
-- 「参加するまで担当欄が空のまま」になっていた。招待そのものを一時的な担当者として置けるようにし、
-- 承諾した瞬間に本人（assignee_id）へ自動で移す。
--
-- 不変条件:
--   - assignee_id と assignee_invite_id は同時に入らない（どちらか一方、または両方 null）
--   - 招待が取り消し・削除されたら担当は空に戻る（on delete set null）
--   - 承諾時の引き継ぎは rpc_accept_invite の中で行う（同じトランザクション）
--
-- 適用: アプリ稼働中に適用可（列追加のみ・既存行は null）。破壊的変更なし。冪等。

alter table public.tasks
  add column if not exists assignee_invite_id uuid
    references public.invites(id) on delete set null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_single_assignee_chk') then
    alter table public.tasks add constraint tasks_single_assignee_chk
      check (assignee_id is null or assignee_invite_id is null);
  end if;
end $$;

-- 承諾時の引き継ぎ（invite → 該当タスク）で使う
create index if not exists idx_tasks_assignee_invite
  on public.tasks (assignee_invite_id)
  where assignee_invite_id is not null;

comment on column public.tasks.assignee_invite_id is
  '招待中の担当者（invites.id）。承諾時に rpc_accept_invite が assignee_id へ移して null にする。assignee_id とは排他';
