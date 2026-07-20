-- =============================================================================
-- integration_connections.import_config の org 境界検証トリガー
-- =============================================================================
--
-- 背景:
--   import_config jsonb には { target_space_id, read_list_ids?, default_assignee_id? }
--   を書ける（20260720125427_connector_two_way_sync.sql で器を追加済み）。
--   書込の認可（誰が書けるか）は既存 RLS（20260214_000_integration_connections.sql,
--   owner_type='org' は role='owner' の org member のみ UPDATE 可）が担う。
--   しかし RLS は「接続レコードの org に属するか」しか見ないため、
--   import_config の中身が別 org の space（target_space_id）や org 外ユーザー
--   （default_assignee_id）を指しても素通りしてしまう。
--
-- 決定（Fable）:
--   BEFORE INSERT/UPDATE トリガーで「何を書けるか」を検証して拒否する。
--   RLS=誰が書けるか / トリガー=何を書けるか、と責務分離し、全書込経路
--   （REST/RPC/SQL いずれも）を1構造で塞ぐ。
--
-- 不変条件:
--   - import_config.target_space_id は接続と同じ org の space を指すこと
--   - import_config.default_assignee_id は接続と同じ org のメンバーであること
--   read_list_ids など org 境界に関与しない項目は検証しない
--   （ワーカーの寛容パースに委ねる）。
--
-- ロールバック / 不可逆性:
--   このマイグレーションはトリガー＋関数の追加のみ（列・データ変更なし）。
--   完全に可逆: `drop trigger ...; drop function ...;` で元に戻せる。
--   既存データは変更しないが、適用後は「既に不正な import_config を持つ行」を
--   UPDATE する際、import_config を変更しない限り素通し（下記ホットパス条件）、
--   import_config を変更するなら検証が走る点に注意。
-- =============================================================================

create or replace function public.integration_connections_validate_import_config()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id text;
  v_assignee text;
  v_space_org uuid;
begin
  -- ホットパス(token refresh 等・import_config 非変更)は素通し。
  -- is not distinct from で NULL 同士も等価扱いにし、無変更 UPDATE の検証コストを避ける。
  if tg_op = 'UPDATE' and new.import_config is not distinct from old.import_config then
    return new;
  end if;

  if jsonb_typeof(new.import_config) is distinct from 'object' then
    raise exception 'import_config must be a JSON object';
  end if;

  -- target_space_id: 接続と同じ org の space を指すこと。
  -- 不正な UUID 文字列(例 'not-a-uuid')は ::uuid キャストで例外→拒否される（意図どおり）。
  v_space_id := new.import_config->>'target_space_id';
  if v_space_id is not null then
    select org_id into v_space_org from public.spaces where id = v_space_id::uuid;
    if v_space_org is null or v_space_org <> new.org_id then
      raise exception 'import_config.target_space_id must reference a space in the connection''s org';
    end if;
  end if;

  -- default_assignee_id: 接続と同じ org のメンバーであること。
  -- 不正な UUID 文字列は ::uuid キャストで例外→拒否される（意図どおり）。
  v_assignee := new.import_config->>'default_assignee_id';
  if v_assignee is not null then
    if not exists (
      select 1 from public.org_memberships
      where org_id = new.org_id and user_id = v_assignee::uuid
    ) then
      raise exception 'import_config.default_assignee_id must be a member of the connection''s org';
    end if;
  end if;

  return new;
end;
$$;

-- BEFORE INSERT OR UPDATE トリガーとして張る（drop if exists で冪等に）
drop trigger if exists integration_connections_validate_import_config
  on public.integration_connections;

create trigger integration_connections_validate_import_config
  before insert or update on public.integration_connections
  for each row
  execute function public.integration_connections_validate_import_config();
