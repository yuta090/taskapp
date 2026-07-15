-- =============================================================================
-- Stage 2.7-B §5(b): 承認依頼を通知センター(notifications)にも出す
--
-- pending 候補が作られたら、責任者の in_app 通知を1件作る（LINE 1:1・確認待ちトレイと並ぶ
-- 3つ目の面）。夜間ingest(SQL)・即時メンション(TS)の両経路が同じ channel_digest_tasks への
-- 書き込みを通るため、*トリガーで一元化* する（各経路に発火を散らさない）。
--
-- 不変条件:
--   - 認可ファースト: requested_to が *現在も* 承認権限を持つ場合のみ通知（_digest_actor_can_approve）。
--     退職・space外し・責任者交代後の人へは出さない（LINE/トレイと同一ガード）。
--   - 冪等: dedupe_key = 'digest_approval:<task_id>'、unique(to_user_id, channel, dedupe_key) と
--     on conflict do nothing で二重作成しない（ingest再実行・複数回pendingでも1件）。
--   - space_id は NOT NULL。pending は space 紐付け時のみ作られるが、防御的に g.space_id not null を要求。
--   - 後始末: pending→promoted/rejected に遷移したら当該通知を既読化し、承認済みの依頼を残さない。
-- =============================================================================

create or replace function public.channel_digest_tasks_notify_approver()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 1) pending になった（新規 or 遷移）→ 責任者へ承認依頼通知（認可を満たす場合のみ）
  if new.promotion_state = 'pending'
     and new.requested_to_user_id is not null
     and (tg_op = 'INSERT' or old.promotion_state is distinct from 'pending')
     and public._digest_actor_can_approve(new, new.requested_to_user_id)
  then
    insert into public.notifications (org_id, space_id, to_user_id, channel, type, dedupe_key, payload)
    select
      new.org_id, g.space_id, new.requested_to_user_id, 'in_app', 'digest_approval_request',
      'digest_approval:' || new.id::text,
      jsonb_build_object(
        'digest_task_id', new.id,
        'title', new.title,
        'due_date', new.due_date,
        'due_time', new.due_time,
        'assignee_hint', new.assignee_hint,
        'group_name', g.display_name
      )
    from public.channel_groups g
    where g.id = new.group_id and g.space_id is not null
    -- 同一 task を none→pending で再依頼した場合、既読/対応済みの残骸を復活させる
    -- （DO NOTHING だと過去の既読状態が残り新しい依頼が通知として立たない）。
    on conflict (to_user_id, channel, dedupe_key) do update
      set payload = excluded.payload,
          read_at = null,
          actioned_at = null,
          created_at = now();
  end if;

  -- 2) pending から抜けた（promoted/rejected/none いずれも）→ 承認依頼通知を既読化。
  -- 責任者交代(rpc_set_group_approver)は pending→none にするため none も掃除対象に含める
  -- （旧責任者の受信箱に承認済みでない古い依頼を残さない）。
  if tg_op = 'UPDATE'
     and old.promotion_state = 'pending'
     and new.promotion_state is distinct from 'pending'
  then
    update public.notifications
       set read_at = coalesce(read_at, now()),
           actioned_at = coalesce(actioned_at, now())
     where channel = 'in_app'
       and type = 'digest_approval_request'
       and dedupe_key = 'digest_approval:' || new.id::text;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_channel_digest_tasks_notify_approver on public.channel_digest_tasks;
create trigger trg_channel_digest_tasks_notify_approver
  after insert or update on public.channel_digest_tasks
  for each row execute function public.channel_digest_tasks_notify_approver();

-- 遷移時の後始末 UPDATE は dedupe_key で引く。unique index は to_user_id 先頭で使えないため
-- 承認依頼だけの部分インデックスを足す（notifications 肥大時のフルスキャン回避）。
create index if not exists notifications_digest_approval_dedupe_idx
  on public.notifications (dedupe_key)
  where channel = 'in_app' and type = 'digest_approval_request';

-- =============================================================================
-- 検証（scratch）:
--   1) pending挿入(認可OK)→ digest_approval_request 通知が1件・payloadにtitle/group_name
--   2) 再挿入/再pending → dedupeで増えない
--   3) 認可NG(退職/交代/space外し)→ 通知は作られない
--   4) promoted/rejected へ遷移 → 当該通知が read_at/actioned_at 埋まる
-- ロールバック:
--   drop trigger trg_channel_digest_tasks_notify_approver on public.channel_digest_tasks;
--   drop function public.channel_digest_tasks_notify_approver();
-- =============================================================================
