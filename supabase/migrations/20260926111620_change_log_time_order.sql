-- =============================================================================
-- change_log を「時刻の新しい順」で読むための索引と、検索関数の並び順
-- =============================================================================
-- 運営画面 /admin/change-log は、組織・人・期間で絞って新しい順に100件を出す。
-- 既存の索引は (org_id, occurred_at desc)・(actor_user_id, occurred_at desc) で、並び順を id にすると
-- 索引の順に読めず、表が育つと該当行を全部読んでから並べ直すことになる。
-- 並び順を occurred_at desc, id desc にそろえ、絞り込みなし／期間だけのとき用に
-- (occurred_at desc, id desc) の索引を足す。
--
-- occurred_at は取引の開始時刻（now()）。同じ時刻の行は id（書き込んだ順）で並ぶので、表示の順はほぼ変わらない。
--
-- 冪等: 索引は if not exists、関数は create or replace（引数・戻り値は同じなので実行権はそのまま残る）。
-- ロールバックは末尾。
-- =============================================================================

create index if not exists change_log_occurred_at_idx on public.change_log (occurred_at desc, id desc);

create or replace function public.rpc_change_log_search(
  p_org_id uuid default null,
  p_table text default null,
  p_row_id text default null,
  p_actor uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit int default 100
)
  returns setof public.change_log
  language plpgsql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
begin
  if not coalesce(public.rpc_is_superadmin(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 与えられた条件だけで問い合わせを組む（行ごとの検索が change_log_table_row_id_idx をそのまま使えるように）。
  -- 値はすべて using で渡す
  return query execute
    'select c.* from public.change_log c where true'
    || case when p_org_id is not null then ' and c.org_id = $1' else '' end
    || case when p_table is not null then ' and c.table_name = $2' else '' end
    || case when p_row_id is not null then ' and (c.row_pk ->> ''id'') = $3' else '' end
    || case when p_actor is not null then ' and c.actor_user_id = $4' else '' end
    || case when p_from is not null then ' and c.occurred_at >= $5' else '' end
    || case when p_to is not null then ' and c.occurred_at < $6' else '' end
    || ' order by c.occurred_at desc, c.id desc limit $7'
    using p_org_id, p_table, p_row_id, p_actor, p_from, p_to, least(greatest(coalesce(p_limit, 100), 1), 1000);
end;
$$;

-- create or replace では実行権は変わらないが、念のため 20260926091821 と同じ形を書き直す
revoke all on function public.rpc_change_log_search(uuid, text, text, uuid, timestamptz, timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.rpc_change_log_search(uuid, text, text, uuid, timestamptz, timestamptz, int)
  to authenticated;

-- ロールバック:
--   drop index if exists public.change_log_occurred_at_idx;
--   rpc_change_log_search は 20260926091821_change_log.sql 節 8 の定義（order by c.id desc）を流し直す
