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
