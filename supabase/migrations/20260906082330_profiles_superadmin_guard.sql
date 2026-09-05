-- =============================================================================
-- profiles.is_superadmin の権限昇格ガード
--
-- 背景（2026-09-06 本番で確認・ロールバック済）:
--   profiles の UPDATE ポリシーは「自分の行は更新可」で列の制限がなく、is_superadmin 列にも
--   authenticated の UPDATE 権限が付いていた。そのためログイン済みの一般ユーザーが
--   `update profiles set is_superadmin = true where id = auth.uid()` を Supabase API 経由で
--   実行するだけで /admin 全ページ・運営 API の門番（is_superadmin チェック）を通過できた。
--
-- 対策: BEFORE トリガーで「旗の変更は特権ロールだけ」に固定する。
--   - 許可: service_role（運営 API のサービス鍵）/ postgres・supabase_admin（migration・ダッシュボード）
--   - 拒否: anon / authenticated（アプリ API 経由）。通常のプロフィール編集は影響なし。
--   列 GRANT の剥奪でなくトリガーにした理由: Postgres は表全体の UPDATE 権限があると列 REVOKE が
--   効かず、表権限を落として列ごとに GRANT し直す方式は「後から足した列が黙って更新不可になる」
--   事故を招く。トリガーなら列追加の影響を受けない。
--   SECURITY DEFINER 関数（owner=postgres）経由は current_user=postgres なので通る＝意図的な特権経路。
-- =============================================================================

create or replace function public.guard_profiles_superadmin()
returns trigger
language plpgsql
as $$
declare
  v_changed boolean;
begin
  if tg_op = 'INSERT' then
    v_changed := coalesce(new.is_superadmin, false);
  else
    v_changed := new.is_superadmin is distinct from old.is_superadmin;
  end if;

  if v_changed and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'is_superadmin は運営（service role）だけが変更できます'
      using errcode = '42501'; -- insufficient_privilege
  end if;

  return new;
end;
$$;

comment on function public.guard_profiles_superadmin() is
  'profiles.is_superadmin の変更を service_role/postgres に限定する（一般ユーザーの自己昇格を防ぐ）';

drop trigger if exists profiles_superadmin_guard on public.profiles;
create trigger profiles_superadmin_guard
  before insert or update on public.profiles
  for each row execute function public.guard_profiles_superadmin();

-- =============================================================================
-- 運営の付与・剥奪の正規経路: rpc_admin_set_superadmin（service_role 専用）
--
-- API 側の「呼び出し側は運営か」「自分自身は外せない」だけでは、運営 A と B が同時に
-- 互いを外す競合で運営が 0 人になり得る（両者とも認可を通過してから更新が走る）。
-- 認可の再確認と更新を同一トランザクション内で advisory lock により直列化し、
-- 後から来た側は actor が既に非運営なので 42501 で止まる。
--   42501 (insufficient_privilege): actor が運営でない（剥奪済みの遅延リクエストを含む）
--   AD001: 自分自身の剥奪
--   P0002 (no_data_found): target が存在しない
-- SECURITY DEFINER（owner=postgres）なので上のトリガーは通る＝意図した特権経路。
-- =============================================================================
create or replace function public.rpc_admin_set_superadmin(
  p_actor uuid,
  p_target uuid,
  p_flag boolean
)
returns table (id uuid, is_superadmin boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_actor is null or p_target is null or p_flag is null then
    raise exception 'p_actor, p_target, p_flag are required' using errcode = '22023';
  end if;

  -- 旗の変更を全体で直列化（付与・剥奪が同時に走っても一度に 1 件ずつ）
  perform pg_advisory_xact_lock(hashtext('profiles.is_superadmin'));

  if not exists (select 1 from public.profiles p where p.id = p_actor and p.is_superadmin) then
    raise exception 'actor is not superadmin' using errcode = '42501';
  end if;

  if p_actor = p_target and not p_flag then
    raise exception 'cannot revoke own superadmin' using errcode = 'AD001';
  end if;

  update public.profiles p set is_superadmin = p_flag where p.id = p_target;
  if not found then
    raise exception 'target user not found' using errcode = 'P0002';
  end if;

  return query select p.id, p.is_superadmin from public.profiles p where p.id = p_target;
end;
$$;

comment on function public.rpc_admin_set_superadmin(uuid, uuid, boolean) is
  '運営(superadmin)の付与・剥奪。service_role 専用。advisory lock で直列化し actor を再確認する';

revoke execute on function public.rpc_admin_set_superadmin(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.rpc_admin_set_superadmin(uuid, uuid, boolean) to service_role;
