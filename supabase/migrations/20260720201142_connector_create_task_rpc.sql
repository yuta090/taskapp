-- =============================================================================
-- コネクタ受信起票 RPC: rpc_connector_create_task
--
-- 目的: multica 等の外部ツール起点の新規タスク起票(webhook `task.created` 受信)を、
--   tasks 行 + connector_task_links を1トランザクションで冪等に作る。webhook は
--   at-least-once で再送されるため、(connection_id, external_id) 一意で重複起票を防ぐ。
--   土台: 20260720125427_connector_two_way_sync.sql（connector_task_links / origin）。
--
-- 冪等・並行の意味論:
--   1) 先に (connection_id, external_id) の既存 link を引き、あればその task_id を返す
--      （新規作成しない）。=通常の再送吸収。
--   2) 並行再送で 1) を2本ともすり抜けた場合（READ COMMITTED では相手の未コミット行が
--      見えない）、両方が task を作り link insert で衝突する。unique(connection_id,
--      external_id) が敗者を弾き、on conflict do nothing → FOUND=false → 敗者は自分が
--      作った孤児 task を補償削除して勝者の task_id を返す。import.ts の 23505 補償と同型。
--
-- 提供仕様(draft)からの必須修正（実 DDL 検証の結果・下記コメント参照）:
--   A) created_by: tasks.created_by は NOT NULL・default 無し・auth.users(id) FK
--      （20240101_000_schema.sql:106）。webhook 経由の SECURITY DEFINER は auth.uid()
--      が null のため補完必須。外部起票に対応する対話ユーザーは存在しないので、接続の org の
--      owner を「取り込みタスクの名義」に採る（org 内メンバーが保証されテナント越境しない）。
--      ※ この名義選定はレビューで差し替え可（例: import_config.default_assignee_id や
--        専用システムユーザー）。列は変更しない方針のため RPC 側で解決する。
--   B) client_scope: default 'deliverable'（20260101000000_baseline_client_scope.sql:31）
--      のままだと外部由来タスクが顧客ポータルに露出する。'internal' を明示する
--      （ball='internal' なので enforce_ball_client_scope は internal を許す）。
--      digest 昇格 RPC(20260715074403)と同じ判断。
--   C) description: NOT NULL default ''（同 :93）。明示 NULL を入れると default は適用されず
--      NOT NULL 違反になるため coalesce(p_description, '') で埋める。
--
-- 制約充足の確認（tasks / 20240101_000_schema.sql）:
--   - status  in ('backlog','todo','in_progress','in_review','done','considering') → 'todo' OK
--   - ball    in ('client','internal')                                             → 'internal' OK
--   - origin  in ('client','internal')                                             → 'internal' OK
--   - type    in ('task','spec')                                                   → 'task' OK
--   - title NOT NULL / description NOT NULL / created_by NOT NULL → 本 insert で充足
--   - 対象 space が 'personal' の場合は enforce_personal_task_rules トリガーが
--     auth.uid()(=null) と owner 不一致で reject する（安全側 fail・取り込みは project space 前提）。
--
-- 適用: 新規関数のみ（列・既存オブジェクト不変）。アプリ稼働中に適用可。
-- ロールバック（可逆）: drop function public.rpc_connector_create_task(uuid,text,uuid,text,text);
--   本 RPC 経由で作成済みの tasks 行/link は残る（データは削除しない＝取り込み結果は不可逆）。
-- =============================================================================

create or replace function public.rpc_connector_create_task(
  p_connection_id uuid,
  p_external_id text,
  p_space_id uuid,
  p_title text,
  p_description text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_space_org uuid;
  v_creator uuid;
  v_task_id uuid;
  v_existing uuid;
begin
  -- 冪等: 既に (connection_id, external_id) の link があればその task を返す（新規作成しない）。
  select task_id into v_existing from public.connector_task_links
    where connection_id = p_connection_id and external_id = p_external_id;
  if v_existing is not null then return v_existing; end if;

  select org_id into v_org from public.integration_connections where id = p_connection_id;
  if v_org is null then raise exception 'connection not found'; end if;

  -- drift 防御: 取り込み先 space は接続の org に属すること（import_config トリガーの二重化）。
  select org_id into v_space_org from public.spaces where id = p_space_id;
  if v_space_org is null or v_space_org <> v_org then
    raise exception 'target space not in connection org';
  end if;

  -- created_by 補完(A): 外部起票に対話ユーザーは無いため接続 org の owner を名義に採る。
  -- org 内メンバーが保証され越境しない。org には必ず owner が居るが、防御的に存在検査する。
  select user_id into v_creator
    from public.org_memberships
    where org_id = v_org and role = 'owner'
    order by created_at asc
    limit 1;
  if v_creator is null then raise exception 'no org owner to attribute created_by'; end if;

  insert into public.tasks
    (org_id, space_id, title, description, status, ball, origin, type, client_scope, created_by)
    values (
      v_org, p_space_id,
      coalesce(nullif(btrim(p_title), ''), '(無題)'),
      coalesce(p_description, ''),   -- (C) NOT NULL・default '' は明示NULLで発火しない
      'todo', 'internal', 'internal', 'task',
      'internal',                    -- (B) 'deliverable' default だと顧客ポータルへ露出
      v_creator                      -- (A) 名義 = 接続 org の owner
    )
    returning id into v_task_id;

  insert into public.connector_task_links (connection_id, task_id, external_id, origin)
    values (p_connection_id, v_task_id, p_external_id, 'external')
    on conflict (connection_id, external_id) do nothing;

  -- 並行再送で link を他 insert が先取りした場合、今作った task は孤児 → 補償削除して勝者を返す。
  if not found then
    select task_id into v_existing from public.connector_task_links
      where connection_id = p_connection_id and external_id = p_external_id;
    delete from public.tasks where id = v_task_id;
    return v_existing;
  end if;

  return v_task_id;
end;
$$;

-- 権限(7 と同方針): 新規 SECURITY DEFINER 関数の EXECUTE は既定で PUBLIC に付くため、
--   明示 revoke しないと anon/authenticated が直接叩ける。外部から叩くのは webhook(service_role)のみ。
revoke all on function public.rpc_connector_create_task(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.rpc_connector_create_task(uuid, text, uuid, text, text) to service_role;
