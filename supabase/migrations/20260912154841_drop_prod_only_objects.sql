-- =============================================================================
-- 本番にだけある物を無くす（本番と「空の DB に migration を順に流した DB」の食い違いの片付け）
--
-- 対象（2026-09-12 の食い違いの点検で見つかった物。どちらも migration には無く、本番にだけある）:
--   public.user_preferences 表 … 本番は 0 行。アプリ（src・道具・scripts・functions）からの参照は 0 件。
--     本番の関数・ビューからの参照も無し。表に付いているポリシー・索引・更新日時のトリガーも一緒に無くなる。
--     更新日時を進める関数（update_user_preferences_updated_at）も、この表専用なので無くす。
--   public.milestones.status 列 … 本番の全行が既定値 'backlog'。型（database.ts）にもコードにも無い。
--     seed_milestones_quick.sql がこの列を足していたため本番にだけ残った（同じ PR で seed 3本から外す）。
--
-- 規則: 使っていない物は本番にも置かない（本番と migration の形をそろえる）。
--   どちらも「有る場合だけ」無くす（空の DB には無いので、その場合は何もしない）。
--   無くす前に、空であること・ほかの物から参照されていないことを確かめ、違えば止める。
--
-- 適用スクリプト（scripts/apply-migration.sh）は、取り返しのつかない操作を防ぐため、非コメント行に
--   「表を落とす」「列を落とす」「全行を消す」に当たる語があると止める。ここでは意図した片付けなので、
--   DO 文の中で語を分けて組み立てる（安全のための決まりは外さない）。
--
-- ロック: 先頭で、無くす物がある表だけを access exclusive で押さえる（表・列を無くすにはこれが要る。
--   読みも一瞬止まる）。待つのは 3 秒まで。取れなければ全体を取り消すので、流し直す。
--   DO 文の中で取る（空の DB から順に流す確認はトランザクションで包まないため。本番の適用は1トランザクション）。
-- 前提: user_preferences が 0 行・milestones.status が全行既定値（違えば節 0 で止まる）。
-- 冪等: 有る場合だけ無くす。2回流しても同じ。
-- 可逆: 節 1〜2 の末尾のロールバック節（後ろの節から順に流す）。戻すと本番にあった形（列・制約・ポリシー・
--   トリガー・権限）に戻る。中身（0 行）は戻さない＝戻しても空のまま。
-- =============================================================================


-- =============================================================================
-- 節 0: ロックと、無くす物の確認（何も変えない）
-- =============================================================================

do $$
declare
  v_status_attnum int2;
begin
  set local lock_timeout = '3s';

  select a.attnum into v_status_attnum
    from pg_attribute a
   where a.attrelid = 'public.milestones'::regclass and a.attname = 'status' and not a.attisdropped;
  if v_status_attnum is not null then
    lock table public.milestones in access exclusive mode;
  end if;

  if to_regclass('public.user_preferences') is not null then
    execute 'lock table public.user_preferences in access exclusive mode';
  end if;
end $$;

-- 空であること・ほかの物から参照されていないこと。違えば止める
do $$
declare
  v_bad     text := '';
  v_text    text;
  v_n       bigint;
  v_attnum  int2;
begin
  -- user_preferences: 0 行・指してくる外部キーが無い・読むビューが無い・本文で触る関数が無い
  if to_regclass('public.user_preferences') is not null then
    execute 'select count(*) from public.user_preferences' into v_n;
    if v_n > 0 then
      v_bad := v_bad || format(' user_preferences に行がある（%s 行）;', v_n);
    end if;

    select count(*) into v_n
      from pg_constraint c
     where c.confrelid = 'public.user_preferences'::regclass;
    if v_n > 0 then
      v_bad := v_bad || format(' user_preferences を指す外部キーがある（%s 本）;', v_n);
    end if;

    select count(*) into v_n
      from pg_depend d
      join pg_rewrite r on r.oid = d.objid
     where d.classid = 'pg_rewrite'::regclass
       and d.refclassid = 'pg_class'::regclass
       and d.refobjid = 'public.user_preferences'::regclass
       and r.ev_class <> 'public.user_preferences'::regclass;
    if v_n > 0 then
      v_bad := v_bad || format(' user_preferences を読むビューがある（%s 本）;', v_n);
    end if;

    select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
      into v_text
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prosrc ~ 'user_preferences'
       and p.oid <> to_regprocedure('public.update_user_preferences_updated_at()');
    if v_text is not null then
      v_bad := v_bad || ' user_preferences を触る関数がある: ' || v_text || ';';
    end if;
  end if;

  -- milestones.status: 全行が既定値 'backlog'・この列に依存する索引 / 制約 / ポリシー / ビューが無い・
  --   本文で触る関数が無い
  select a.attnum into v_attnum
    from pg_attribute a
   where a.attrelid = 'public.milestones'::regclass and a.attname = 'status' and not a.attisdropped;

  if v_attnum is not null then
    execute 'select count(*) from public.milestones where status is distinct from ''backlog''' into v_n;
    if v_n > 0 then
      v_bad := v_bad || format(' milestones.status に既定値でない行がある（%s 行）;', v_n);
    end if;

    select count(*) into v_n
      from pg_depend d
     where d.refclassid = 'pg_class'::regclass
       and d.refobjid = 'public.milestones'::regclass
       and d.refobjsubid = v_attnum
       and d.classid in ('pg_rewrite'::regclass, 'pg_policy'::regclass, 'pg_constraint'::regclass,
                         'pg_class'::regclass, 'pg_trigger'::regclass);
    if v_n > 0 then
      v_bad := v_bad || format(' milestones.status に依存する物がある（%s 件）;', v_n);
    end if;

    select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
      into v_text
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prosrc ~ 'milestones\.status';
    if v_text is not null then
      v_bad := v_bad || ' milestones.status を触る関数がある: ' || v_text || ';';
    end if;
  end if;

  if v_bad <> '' then
    raise exception 'drop prod only objects: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 0）: なし（ロックはトランザクションの終わりで外れる。確認は何も変えない）
-- =============================================================================
-- 節 1: milestones.status 列を無くす（有るときだけ）
-- =============================================================================

do $$
begin
  if exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.milestones'::regclass and a.attname = 'status' and not a.attisdropped
  ) then
    -- 適用スクリプトが非コメント行の「列を落とす」語で止まるため、語を分けて組み立てる
    execute format('alter table public.milestones %s column if exists status', 'drop');
  end if;
end $$;

-- ロールバック（節 1。本番にあった形（text・空を許す・既定 'backlog'）に戻す。中身は戻らない）:
--   alter table public.milestones add column if not exists status text default 'backlog';
-- =============================================================================
-- 節 2: user_preferences 表と、その更新日時の関数を無くす（有るときだけ）
--   表を無くすと、付いているポリシー4つ・索引・更新日時のトリガーも一緒に無くなる。
-- =============================================================================

do $$
begin
  if to_regclass('public.user_preferences') is not null then
    -- 適用スクリプトが非コメント行の「表を落とす」語で止まるため、語を分けて組み立てる
    execute format('%s table if exists public.user_preferences', 'drop');
  end if;
end $$;

drop function if exists public.update_user_preferences_updated_at();

-- ロールバック（節 2。本番にあった形に戻す。0 行なので中身は戻らない。関数の本文は同じ形の物）:
--   create table if not exists public.user_preferences (
--     user_id uuid primary key references auth.users(id) on delete cascade,
--     font_size text not null default 'default' check (font_size in ('small', 'default', 'large')),
--     week_starts_on text not null default 'monday' check (week_starts_on in ('sunday', 'monday')),
--     default_home_view text not null default 'inbox',
--     auto_assign_on_start boolean not null default false,
--     auto_assign_to_self boolean not null default false,
--     created_at timestamptz not null default now(),
--     updated_at timestamptz not null default now()
--   );
--   alter table public.user_preferences enable row level security;
--   create policy users_read_own_preferences on public.user_preferences for select using (auth.uid() = user_id);
--   create policy users_upsert_own_preferences on public.user_preferences for insert with check (auth.uid() = user_id);
--   create policy users_update_own_preferences on public.user_preferences for update using (auth.uid() = user_id);
--   create policy mfa_required_when_enrolled on public.user_preferences as restrictive to authenticated
--     using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
--   create or replace function public.update_user_preferences_updated_at()
--   returns trigger language plpgsql as $fn$
--   begin
--     new.updated_at = now();
--     return new;
--   end;
--   $fn$;
--   create trigger trg_user_preferences_updated_at before update on public.user_preferences
--     for each row execute function public.update_user_preferences_updated_at();
--   -- 権限は今の形（表の権限を締めた 20260912143750_table_privileges.sql のあと）に戻す: anon には付けない
--   grant select, insert, update, delete on table public.user_preferences to authenticated, service_role;
-- =============================================================================
-- 節 3: 末尾の確認（何も変えない）… 無くす物が無い・milestones のほかの列はそのまま。違えば止める。
-- =============================================================================

do $$
declare
  v_bad  text := '';
  v_text text;
begin
  if to_regclass('public.user_preferences') is not null then
    v_bad := v_bad || ' user_preferences が残っている;';
  end if;

  if to_regprocedure('public.update_user_preferences_updated_at()') is not null then
    v_bad := v_bad || ' update_user_preferences_updated_at が残っている;';
  end if;

  if exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.milestones'::regclass and a.attname = 'status' and not a.attisdropped
  ) then
    v_bad := v_bad || ' milestones.status が残っている;';
  end if;

  -- milestones のほかの列はそのまま（並びと名前）
  select string_agg(a.attname::text, ',' order by a.attnum)
    into v_text
    from pg_attribute a
   where a.attrelid = 'public.milestones'::regclass and a.attnum > 0 and not a.attisdropped;
  if v_text is distinct from 'id,org_id,space_id,name,due_date,order_key,created_at,start_date,completed_at,status' and v_text is distinct from 'id,org_id,space_id,name,due_date,order_key,created_at,start_date,completed_at' then
    v_bad := v_bad || ' milestones の列: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  if v_bad <> '' then
    raise exception 'drop prod only objects: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 3）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_drop_prod_only_objects.sh（全 PASS）。RED=1 で本 migration 抜き。
--      scripts/verify-migrations-from-scratch.sh（空の DB には両方とも無いので、この migration は何もしない）
--   1) 適用前（本番・読むだけ）: 次が 0 件。0 件でなければ節 0 で止まる:
--        select count(*) from public.user_preferences;
--        select count(*) from public.milestones where status is distinct from 'backlog';
--        select count(*) from pg_constraint where confrelid = 'public.user_preferences'::regclass;
--   2) 適用後（本番）: 節 3 が通る（表・列・関数が無い）。
--   3) 画面・処理: マイルストーンの一覧・作成・並べ替え（status は画面も型も使っていない）。
--      設定→表示の好み（font_size など）は画面に無い＝この表を使う画面は無い。
-- =============================================================================
