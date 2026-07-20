-- =============================================================================
-- コネクタ・システムユーザー seed ＋ 外部起票の created_by 名義の一本化
--
-- 決定: Fable 2026-07-20（案A改）。外部ツール(gtasks/multica)起点で取り込むタスクの
--   created_by を「接続 org の owner」（＝テナントの実ユーザー。実際にはその人が作っていない）から、
--   固定UUIDの単一グローバル・システムユーザーへ一本化する。env var もフォールバックも持たない。
--
-- 本 migration の4段（順序に意味あり）:
--   (a) auth.users にシステムユーザーを冪等 seed（ログイン不能を多層で担保）
--   (b) public.profiles を決定的に上書き（トリガー生成に依存せず表示名を固定）
--   (c) rpc_connector_create_task を置換（org-owner 解決を撤去し固定UUIDを直接使う・fail-loud）
--   (d) origin='external' の既存タスクを backfill（org-owner 名義で作られた分をシステムユーザーへ）
--
-- 不可逆性: tasks.created_by は auth.users(id) への FK（ON DELETE 指定なし＝NO ACTION）。
--   システムユーザー名義のタスクが1件でもできると、この auth.users 行は実質削除不能になる。
--   固定UUID は永続 ID として扱うこと（誤削除防御。検証項目 #7）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (a) システムユーザーを auth.users に seed（冪等）
--
-- ログイン不能の4層担保:
--   ① banned_until を遠未来 → GoTrue は全経路(password/OTP/recovery)でトークン発行を拒否（主担保）
--   ② encrypted_password を NULL（省略） → password grant が不成立
--   ③ email 未確認 ＋ RFC2606 予約TLD `.invalid` ドメイン → magic link / recovery が到達し得ない
--   ④ org_memberships 行を作らない → 万一トークンが出ても RLS でテナントデータは不可視
--
-- 触ってはいけない列: confirmed_at（generated column。INSERT に含めると失敗する）。
--   auth.identities 行は作らない。role/aud は標準値 'authenticated'（非標準値は GoTrue admin 一覧を壊す）。
-- -----------------------------------------------------------------------------
insert into auth.users
  (id, instance_id, aud, role, email,
   raw_app_meta_data, raw_user_meta_data,
   banned_until, created_at, updated_at)
values
  ('00000000-0000-4000-a000-000000000001',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated',
   'connector-system@taskapp.invalid',          -- RFC2606 予約TLD = メール到達不能
   '{"provider":"system","providers":["system"]}'::jsonb,
   '{"name":"外部連携（システム）"}'::jsonb,
   '3000-01-01T00:00:00Z', now(), now())
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- (b) profiles を決定的に上書き（on_auth_user_created トリガーの生成結果に依存しない）
--   authenticated は profiles を SELECT 可（20240203_000_profiles.sql）なので、タスク詳細の
--   作成者表示に「外部連携（システム）」が出る。UI 改修は不要。
-- -----------------------------------------------------------------------------
insert into public.profiles (id, display_name)
values ('00000000-0000-4000-a000-000000000001', '外部連携（システム）')
on conflict (id) do update set display_name = excluded.display_name;

-- -----------------------------------------------------------------------------
-- (c) rpc_connector_create_task を置換
--   シグネチャは現状維持（p_created_by は追加しない＝呼び出し側に名義選択の自由を与えない）。
--   org-owner 解決ブロックを撤去し固定UUIDを直接使う。owner フォールバックは残さず、
--   システムユーザー未 seed の環境では明示的に fail する（静かな誤名義より明示失敗）。
-- -----------------------------------------------------------------------------
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
  v_task_id uuid;
  v_existing uuid;
  c_system_user constant uuid := '00000000-0000-4000-a000-000000000001';
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

  -- created_by 補完: 外部起票に対話ユーザーは無いため専用システムユーザー名義にする。
  -- fail-loud: seed migration 未適用の環境で誤名義に倒れないよう存在を明示検査する。
  if not exists (select 1 from auth.users where id = c_system_user) then
    raise exception 'connector system user missing (seed migration not applied)';
  end if;

  insert into public.tasks
    (org_id, space_id, title, description, status, ball, origin, type, client_scope, created_by)
    values (
      v_org, p_space_id,
      coalesce(nullif(btrim(p_title), ''), '(無題)'),
      coalesce(p_description, ''),   -- NOT NULL・default '' は明示NULLで発火しないため coalesce で埋める
      'todo', 'internal', 'internal', 'task',
      'internal',                    -- 'deliverable' default だと顧客ポータルへ露出するため internal を明示
      c_system_user                  -- 名義 = 専用システムユーザー（実ユーザー名義にしない）
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

-- 権限（新規 SECURITY DEFINER 関数の EXECUTE は既定で PUBLIC に付くため明示 revoke が必須）。
revoke all on function public.rpc_connector_create_task(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.rpc_connector_create_task(uuid, text, uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- (d) backfill: origin='external' の既存タスクの created_by をシステムユーザーへ寄せる。
--   ⚠ origin='external'（外部が正本の取り込みタスク）だけを対象にする。実ユーザーが TaskApp で
--     作って gtasks/multica へ押し出した mirror 元タスク（link.origin='internal'）は絶対に触らない。
--   本番未稼働前提のため名義履歴の書き換えは許容。
--
-- ⚠ トリガー抑止: public.tasks には AFTER UPDATE の trg_enqueue_task_mirror（20260718092110）が
--   張られており、created_by と無関係に「更新行が mirror 対象か」を再評価する。backfill 対象の
--   assignee が個人 gtasks 接続を持つと、名義書き換えだけで不要な mirror upsert job が入り、正本
--   gtasks とは別リストへ複製され得る。created_by の付け替えは mirror 意味論と無関係なので、当該
--   UPDATE の間だけレプリカロールにしてトリガーを抑止する。migration はトランザクション内で適用され
--   set local はその tx 限定・COMMIT で自動復帰する（FK 検査は system user が (a) で存在済みのため無害）。
-- -----------------------------------------------------------------------------
set local session_replication_role = replica;

update public.tasks t
   set created_by = '00000000-0000-4000-a000-000000000001'
  from public.connector_task_links l
 where l.task_id = t.id
   and l.origin = 'external'
   and t.created_by <> '00000000-0000-4000-a000-000000000001';

set local session_replication_role = origin;
