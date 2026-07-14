-- =============================================================================
-- Stage 2.7-B §4-4: 承認確認の 1:1 通知ディスパッチ基盤
--
-- 夜間ingestで作られた pending 候補は、cron(RPC内)から直接LINE送信できないため、
-- 別のディスパッチャ（HTTP経路のcron）が拾って責任者の1:1へ Flex を push する。
-- 二重送信・並行ディスパッチャを避けるため「claim（掴んで notified 印を打つ）」を
-- 単一トランザクションで原子的に行う RPC を提供する。
--
-- 設計:
--   - channel_digest_tasks.approval_notified_at: 1:1 確認を送った時刻。null=未送信。
--   - rpc_claim_pending_approval_notifications(p_limit): pending かつ未通知の候補のうち、
--     責任者(approver)に *有効な1:1紐付けが存在する* ものだけを最大 p_limit 件掴んで
--     approval_notified_at=now() を刻み、送信に必要な最小情報を返す。
--     FOR UPDATE SKIP LOCKED で並行ディスパッチャが同じ行を二重に掴まない。
--   - 紐付けが無い approver の候補は掴まない（印も打たない）=> リンク後に自然にリトライされる。
--     その間もコンソールの「確認待ち」トレイには出るため、通知取りこぼしは可視で回復可能。
--   - access token は暗号化されているため RPC は触らない。app 側が account 単位で復号し push する。
-- =============================================================================

alter table public.channel_digest_tasks
  add column if not exists approval_notified_at timestamptz null;

comment on column public.channel_digest_tasks.approval_notified_at is
  '責任者へ1:1確認Flexを送った時刻。null=未通知。ディスパッチャが claim 時に刻む（Stage 2.7-B）';

-- 未通知の pending を素早く引くための部分インデックス
create index if not exists channel_digest_tasks_pending_unnotified
  on public.channel_digest_tasks(created_at)
  where promotion_state = 'pending' and approval_notified_at is null;

create or replace function public.rpc_claim_pending_approval_notifications(
  p_limit int default 50
)
returns table (
  task_id uuid,
  org_id uuid,
  channel_account_id uuid,
  external_user_id text,
  title text,
  due_date date,
  due_time time
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- LIMIT NULL は「無制限」と解釈されるため必ず正の有界値にクランプする。
  -- 過大な一括claimは、送信タイムアウト/クラッシュ時に大量の行を notified のまま滞留させる。
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 500);
begin
  return query
  with claimed as (
    -- 未通知の pending のうち、approver に有効な1:1紐付けがあるものだけを掴む。
    -- exists で絞る（join で絞ると同一approverが同一accountに複数リンクを持つ場合に
    -- 行が増え、limit/二重送信を歪める）。FOR UPDATE ... SKIP LOCKED で並行claimと排他。
    select d.id
    from public.channel_digest_tasks d
    where d.promotion_state = 'pending'
      and d.approval_notified_at is null
      and exists (
        select 1
        from public.channel_groups g
        join public.channel_user_links l
          on l.channel_account_id = g.account_id
         and l.org_id = d.org_id
         and l.user_id = g.approver_user_id
         and l.revoked_at is null
        where g.id = d.group_id
          and g.approver_user_id is not null
      )
    order by d.created_at
    for update skip locked
    limit v_limit
  ),
  marked as (
    update public.channel_digest_tasks d
      set approval_notified_at = now()
    from claimed c
    where d.id = c.id
    returning d.id, d.org_id, d.group_id, d.title, d.due_date, d.due_time
  )
  select
    m.id, m.org_id, g.account_id, l.ext, m.title, m.due_date, m.due_time
  from marked m
  join public.channel_groups g on g.id = m.group_id
  -- 送信先の external_user_id は 1件に確定させる（同一approverの複数リンク保険で最新1件）。
  -- returns table の OUT 名（external_user_id 等）とテーブル列名が衝突するため、
  -- 副問合せ内は必ずテーブル別名で修飾する（曖昧参照エラーの回避）。
  join lateral (
    select cul.external_user_id as ext
    from public.channel_user_links cul
    where cul.channel_account_id = g.account_id
      and cul.org_id = m.org_id
      and cul.user_id = g.approver_user_id
      and cul.revoked_at is null
    order by cul.linked_at desc
    limit 1
  ) l on true;
end;
$$;

revoke execute on function public.rpc_claim_pending_approval_notifications(int) from public, anon, authenticated;
grant execute on function public.rpc_claim_pending_approval_notifications(int) to service_role;
