-- =============================================================================
-- 社内専用の記録を新しい表に置く（C1: 表・埋め戻し・古い列からのつなぎ）
-- 確定設計: Fable 裁定 2026-09-11
--
-- 規則:
--   task_internal_metrics  タスクの社内専用の記録（実績工数 actual_hours）。タスクと 1:1（task_id が主キー）。
--     読める = その space で社内扱いの社内メンバー（app_is_space_internal。space の役割が client / vendor でない。
--              行が無ければ社内扱い）
--     書ける = app_can_write_space（社内の admin・editor。space に行が無い社内メンバーは editor 扱い）
--   space_agency_settings  space の代理店設定（既定の利益率 default_margin_rate・協力会社向けの表示設定 vendor_settings）。
--     space と 1:1（space_id が主キー）。代理店モード（agency_mode）は spaces に残す。
--     読める = その space で社内扱いの社内メンバー（app_is_space_internal。space の役割が client / vendor でない。
--              行が無ければ社内扱い）
--     書ける = その space の行が admin か editor の社内メンバー
--   どちらの表も:
--     組織と space は元の行（tasks・spaces）から写す（書き手が渡した値は使わない）。
--     元の行を消すと一緒に消える（ON DELETE CASCADE。(space_id, org_id) → spaces(id, org_id) はほかの space 単位の表と同じ形）。
--     二要素認証の RESTRICTIVE ポリシー（mfa_required_when_enrolled）を付ける。
--     ログインしていない人（anon）には表の権限を付けない。authenticated と service_role には使う操作だけ。
--   つなぎ: コードが新しい表を読み書きするようになるまで、古い列（tasks.actual_hours・spaces.default_margin_rate・
--     spaces.vendor_settings）に書かれた値を新しい表へ写す。古い列とつなぎは後の migration（C3）で外す。
--     C3 の順番: ① つなぎのトリガーと関数を外す ② guard_agency_settings から2列（default_margin_rate・vendor_settings）を外し、
--     agency_mode だけを見る本文に作り直す（SECURITY DEFINER・search_path・実行権は保つ）③ 古い3列を消す
--     ④ 古い列を名前で読む関数が0本か確かめる（plpgsql は実行時に列を探すので、② より先に列を消すと spaces の更新が落ちる）。
--
-- 冪等: create table / index if not exists・create or replace function・drop trigger / policy if exists → create・
--   埋め戻しは on conflict do nothing。2回流しても同じ。
-- 可逆: 節 1・3・4 の末尾のロールバック節（後ろの節から順に流す）。古い列とそのデータは変えない。
-- =============================================================================


-- =============================================================================
-- 節 1: 表・索引・外部キー（列の型と CHECK は古い列に合わせる）
-- =============================================================================

create table if not exists public.task_internal_metrics (
  task_id      uuid primary key,
  org_id       uuid not null,
  space_id     uuid not null,
  actual_hours numeric null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint task_internal_metrics_task_id_fkey
    foreign key (task_id) references public.tasks (id) on delete cascade,
  constraint task_internal_metrics_org_id_fkey
    foreign key (org_id) references public.organizations (id) on delete cascade,
  constraint task_internal_metrics_space_org_fkey
    foreign key (space_id, org_id) references public.spaces (id, org_id) on delete cascade
);

-- space を消したときの連鎖削除と、space ごとの読み出し用
create index if not exists task_internal_metrics_space_org_idx
  on public.task_internal_metrics (space_id, org_id);

comment on table public.task_internal_metrics is
  'タスクの社内専用の記録（タスクと 1:1）。読めるのはその space で社内扱いの社内メンバー（space の役割が client / vendor でない。行が無ければ社内扱い）、書けるのは社内の編集者（app_can_write_space）。組織と space はタスクから写す';
comment on column public.task_internal_metrics.actual_hours is '実績工数（時間）';

create table if not exists public.space_agency_settings (
  space_id            uuid primary key,
  org_id              uuid not null,
  default_margin_rate numeric(5,2) null,
  vendor_settings     jsonb not null default '{"show_client_name": false, "allow_client_comments": false}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint space_agency_settings_org_id_fkey
    foreign key (org_id) references public.organizations (id) on delete cascade,
  constraint space_agency_settings_space_org_fkey
    foreign key (space_id, org_id) references public.spaces (id, org_id) on delete cascade,
  constraint space_agency_settings_default_margin_rate_check
    check (default_margin_rate is null or (default_margin_rate >= 0 and default_margin_rate <= 999.99)),
  constraint space_agency_settings_vendor_settings_check
    check (jsonb_typeof(vendor_settings -> 'show_client_name') = 'boolean'
           and jsonb_typeof(vendor_settings -> 'allow_client_comments') = 'boolean')
);

comment on table public.space_agency_settings is
  'space の代理店設定（space と 1:1）。読めるのはその space で社内扱いの社内メンバー（space の役割が client / vendor でない。行が無ければ社内扱い）、書けるのはその space の行が admin / editor の社内メンバー。組織は space から写す';
comment on column public.space_agency_settings.default_margin_rate is '既定の利益率（%）。タスクごとに上書きできる';
comment on column public.space_agency_settings.vendor_settings is '協力会社のポータルの表示設定（代理店モードの space で使う）';

-- ロールバック（節 1。表を消すと中身も消える。コードが新しい表を読み書きする前なら、同じ値は古い列にある）:
--   drop table if exists public.space_agency_settings;
--   drop table if exists public.task_internal_metrics;
-- =============================================================================
-- 節 2: 表の権限・RLS・ポリシー・二要素認証
-- =============================================================================

-- 表の権限: ログインしていない人（anon）には付けない。authenticated と service_role には使う操作だけ
revoke all on table public.task_internal_metrics from public, anon, authenticated, service_role;
revoke all on table public.space_agency_settings from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.task_internal_metrics to authenticated, service_role;
grant select, insert, update on table public.space_agency_settings to authenticated;
grant select, insert, update, delete on table public.space_agency_settings to service_role;

alter table public.task_internal_metrics enable row level security;
alter table public.space_agency_settings enable row level security;

-- task_internal_metrics: 読み = その space で社内扱いの社内メンバー（app_is_space_internal）/ 書き = 社内の編集者（app_can_write_space）
drop policy if exists task_internal_metrics_select_member on public.task_internal_metrics;
create policy task_internal_metrics_select_member
  on public.task_internal_metrics
  for select
  to authenticated
  using ( public.app_is_space_internal(space_id, org_id) );

drop policy if exists task_internal_metrics_insert_member on public.task_internal_metrics;
create policy task_internal_metrics_insert_member
  on public.task_internal_metrics
  for insert
  to authenticated
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists task_internal_metrics_update_member on public.task_internal_metrics;
create policy task_internal_metrics_update_member
  on public.task_internal_metrics
  for update
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) )
  with check ( public.app_can_write_space(space_id, org_id) );

drop policy if exists task_internal_metrics_delete_member on public.task_internal_metrics;
create policy task_internal_metrics_delete_member
  on public.task_internal_metrics
  for delete
  to authenticated
  using ( public.app_can_write_space(space_id, org_id) );

-- space_agency_settings: 読み = その space で社内扱いの社内メンバー（app_is_space_internal）/
--   書き = その space の行が admin か editor の社内メンバー
drop policy if exists space_agency_settings_select_member on public.space_agency_settings;
create policy space_agency_settings_select_member
  on public.space_agency_settings
  for select
  to authenticated
  using ( public.app_is_space_internal(space_id, org_id) );

drop policy if exists space_agency_settings_insert_member on public.space_agency_settings;
create policy space_agency_settings_insert_member
  on public.space_agency_settings
  for insert
  to authenticated
  with check (
    public.app_is_org_internal(org_id)
    and public.app_space_role_of_caller(space_id) in ('admin', 'editor')
  );

drop policy if exists space_agency_settings_update_member on public.space_agency_settings;
create policy space_agency_settings_update_member
  on public.space_agency_settings
  for update
  to authenticated
  using (
    public.app_is_org_internal(org_id)
    and public.app_space_role_of_caller(space_id) in ('admin', 'editor')
  )
  with check (
    public.app_is_org_internal(org_id)
    and public.app_space_role_of_caller(space_id) in ('admin', 'editor')
  );

-- 二要素認証: 登録済みの利用者はコード入力済み（aal2）でなければ触れない（既存の全 RLS 表と同じ。無ければ作る）
do $$
declare
  v_table text;
begin
  foreach v_table in array array['task_internal_metrics', 'space_agency_settings'] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = v_table and policyname = 'mfa_required_when_enrolled'
    ) then
      execute format(
        'create policy mfa_required_when_enrolled on public.%I as restrictive for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))',
        v_table
      );
    end if;
  end loop;
end $$;

-- ロールバック（節 2）: なし（節 1 のロールバックで表ごと消える）
-- =============================================================================
-- 節 3: 組織と space を元の行から写す（新しい表のトリガー）
--   SECURITY DEFINER: 書いた人に見えるかどうかに関わらず、元の行の実際の組織と space を読む
-- =============================================================================

create or replace function public.task_internal_metrics_fill_scope()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_org   uuid;
  v_space uuid;
begin
  select t.org_id, t.space_id into v_org, v_space
    from public.tasks t
   where t.id = new.task_id;
  if not found then
    raise exception 'task not found' using errcode = 'foreign_key_violation';
  end if;

  new.org_id := v_org;
  new.space_id := v_space;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.space_agency_settings_fill_scope()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_org uuid;
begin
  select s.org_id into v_org
    from public.spaces s
   where s.id = new.space_id;
  if not found then
    raise exception 'space not found' using errcode = 'foreign_key_violation';
  end if;

  new.org_id := v_org;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

comment on function public.task_internal_metrics_fill_scope() is
  'task_internal_metrics のトリガー: 組織と space をタスクから写す（書き手の値は使わない）。更新では updated_at を進める';
comment on function public.space_agency_settings_fill_scope() is
  'space_agency_settings のトリガー: 組織を space から写す（書き手の値は使わない）。更新では updated_at を進める';

-- トリガー専用。直接は実行させない（トリガーとしての実行には実行権は要らない）
revoke all on function public.task_internal_metrics_fill_scope() from public, anon, authenticated, service_role;
revoke all on function public.space_agency_settings_fill_scope() from public, anon, authenticated, service_role;

drop trigger if exists trg_task_internal_metrics_fill_scope on public.task_internal_metrics;
create trigger trg_task_internal_metrics_fill_scope
  before insert or update on public.task_internal_metrics
  for each row execute function public.task_internal_metrics_fill_scope();

drop trigger if exists trg_space_agency_settings_fill_scope on public.space_agency_settings;
create trigger trg_space_agency_settings_fill_scope
  before insert or update on public.space_agency_settings
  for each row execute function public.space_agency_settings_fill_scope();

-- ロールバック（節 3）:
--   drop trigger if exists trg_space_agency_settings_fill_scope on public.space_agency_settings;
--   drop trigger if exists trg_task_internal_metrics_fill_scope on public.task_internal_metrics;
--   drop function if exists public.space_agency_settings_fill_scope();
--   drop function if exists public.task_internal_metrics_fill_scope();
-- =============================================================================
-- 節 4: つなぎ — 古い列に書かれた値を新しい表へ写す（コードが新しい表を読み書きするまで）
--   古い列に書けるのは、今までどおりその表の権限（RLS）と見張りが通した人だけ。写すのは SECURITY DEFINER で行う。
-- =============================================================================

create or replace function public.bridge_task_actual_hours()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.actual_hours is not distinct from old.actual_hours then
    return null;
  end if;

  if new.actual_hours is null then
    -- 値を消したときは、記録の行を残して値だけ消す（行が無ければ何もしない）
    update public.task_internal_metrics m
       set actual_hours = null
     where m.task_id = new.id;
  else
    insert into public.task_internal_metrics (task_id, org_id, space_id, actual_hours)
    values (new.id, new.org_id, new.space_id, new.actual_hours)
    on conflict (task_id) do update set actual_hours = excluded.actual_hours;
  end if;
  return null;
end;
$$;

create or replace function public.bridge_space_agency_settings()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- 既定値のまま作った space には、設定の行を作らない
    if new.default_margin_rate is null
       and new.vendor_settings is not distinct from '{"show_client_name": false, "allow_client_comments": false}'::jsonb then
      return null;
    end if;
  elsif new.default_margin_rate is not distinct from old.default_margin_rate
        and new.vendor_settings is not distinct from old.vendor_settings then
    return null;
  end if;

  insert into public.space_agency_settings (space_id, org_id, default_margin_rate, vendor_settings)
  values (new.id, new.org_id, new.default_margin_rate, new.vendor_settings)
  on conflict (space_id) do update
    set default_margin_rate = excluded.default_margin_rate,
        vendor_settings     = excluded.vendor_settings;
  return null;
end;
$$;

comment on function public.bridge_task_actual_hours() is
  'つなぎ: tasks.actual_hours に書かれた値を task_internal_metrics へ写す（コードが新しい表を使うまで。後の migration で外す）';
comment on function public.bridge_space_agency_settings() is
  'つなぎ: spaces.default_margin_rate / vendor_settings に書かれた値を space_agency_settings へ写す（コードが新しい表を使うまで。後の migration で外す）';

-- トリガー専用。直接は実行させない
revoke all on function public.bridge_task_actual_hours() from public, anon, authenticated, service_role;
revoke all on function public.bridge_space_agency_settings() from public, anon, authenticated, service_role;

drop trigger if exists trg_bridge_task_actual_hours on public.tasks;
create trigger trg_bridge_task_actual_hours
  after insert or update of actual_hours on public.tasks
  for each row execute function public.bridge_task_actual_hours();

drop trigger if exists trg_bridge_space_agency_settings on public.spaces;
create trigger trg_bridge_space_agency_settings
  after insert or update of default_margin_rate, vendor_settings on public.spaces
  for each row execute function public.bridge_space_agency_settings();

-- ロールバック（節 4。つなぎを外す。古い列はそのまま）:
--   drop trigger if exists trg_bridge_space_agency_settings on public.spaces;
--   drop trigger if exists trg_bridge_task_actual_hours on public.tasks;
--   drop function if exists public.bridge_space_agency_settings();
--   drop function if exists public.bridge_task_actual_hours();
-- =============================================================================
-- 節 5: 埋め戻し — 古い列に値がある行を新しい表に入れる（すでに行があれば触らない）
-- =============================================================================

insert into public.task_internal_metrics (task_id, org_id, space_id, actual_hours)
select t.id, t.org_id, t.space_id, t.actual_hours
  from public.tasks t
 where t.actual_hours is not null
on conflict (task_id) do nothing;

insert into public.space_agency_settings (space_id, org_id, default_margin_rate, vendor_settings)
select s.id, s.org_id, s.default_margin_rate, s.vendor_settings
  from public.spaces s
 where s.default_margin_rate is not null
    or s.vendor_settings is distinct from '{"show_client_name": false, "allow_client_comments": false}'::jsonb
on conflict (space_id) do nothing;

-- ロールバック（節 5）: なし（節 1 のロールバックで表ごと消える）
-- =============================================================================
-- 節 6: 末尾の確認（何も変えない）… 形・RLS・ポリシー・二要素・表の権限・外部キー・トリガーが想定どおりで、
--   古い列に値がある行がすべて新しい表にある。違えば止める。件数は NOTICE で出す。
-- =============================================================================

do $$
declare
  v_bad   text := '';
  v_text  text;
  v_n     bigint;
  v_old   bigint;
  v_new   bigint;
begin
  -- RLS
  select string_agg(c.relname, ', ') into v_text
    from pg_class c
   where c.oid in ('public.task_internal_metrics'::regclass, 'public.space_agency_settings'::regclass)
     and not c.relrowsecurity;
  if v_text is not null then
    v_bad := v_bad || ' RLS が無効: ' || v_text || ';';
  end if;

  -- ポリシー（名前・操作・RESTRICTIVE かどうか）
  select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || permissive, ','
                    order by tablename collate "C", policyname collate "C")
    into v_text
    from pg_policies
   where schemaname = 'public' and tablename in ('task_internal_metrics', 'space_agency_settings');
  if v_text is distinct from
       'space_agency_settings:mfa_required_when_enrolled:ALL:RESTRICTIVE,'
       'space_agency_settings:space_agency_settings_insert_member:INSERT:PERMISSIVE,'
       'space_agency_settings:space_agency_settings_select_member:SELECT:PERMISSIVE,'
       'space_agency_settings:space_agency_settings_update_member:UPDATE:PERMISSIVE,'
       'task_internal_metrics:mfa_required_when_enrolled:ALL:RESTRICTIVE,'
       'task_internal_metrics:task_internal_metrics_delete_member:DELETE:PERMISSIVE,'
       'task_internal_metrics:task_internal_metrics_insert_member:INSERT:PERMISSIVE,'
       'task_internal_metrics:task_internal_metrics_select_member:SELECT:PERMISSIVE,'
       'task_internal_metrics:task_internal_metrics_update_member:UPDATE:PERMISSIVE' then
    v_bad := v_bad || ' ポリシー: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 読みのポリシーは space の役割を見る（app_is_space_internal）
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public'
     and ((tablename = 'task_internal_metrics' and policyname = 'task_internal_metrics_select_member')
       or (tablename = 'space_agency_settings' and policyname = 'space_agency_settings_select_member'))
     and qual like '%app_is_space_internal(space_id, org_id)%';
  if v_n <> 2 then
    v_bad := v_bad || format(' 読みのポリシーが app_is_space_internal(space_id, org_id) でない（%s / 2）;', v_n);
  end if;

  -- 表の権限: 持ち主のほかは authenticated と service_role だけ（anon と PUBLIC には無い）
  --   a=INSERT r=SELECT w=UPDATE d=DELETE（持ち主 postgres の行は除いて並べる）
  select string_agg(t.tbl || ':' || coalesce((
           select string_agg(a::text, ',' order by a::text)
             from unnest(c.relacl) as a
            where a::text not like 'postgres=%'), '-'), ' ' order by t.o)
    into v_text
    from (values ('metrics', 'public.task_internal_metrics'::regclass, 1),
                 ('agency', 'public.space_agency_settings'::regclass, 2)) as t(tbl, oid, o)
    join pg_class c on c.oid = t.oid;
  if v_text is distinct from
       'metrics:authenticated=arwd/postgres,service_role=arwd/postgres '
       'agency:authenticated=arw/postgres,service_role=arwd/postgres' then
    v_bad := v_bad || ' 表の権限: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 外部キー: 5 本とも ON DELETE CASCADE で確かめ済み
  select count(*) into v_n
    from pg_constraint
   where contype = 'f'
     and conrelid in ('public.task_internal_metrics'::regclass, 'public.space_agency_settings'::regclass)
     and confdeltype = 'c'
     and convalidated;
  if v_n <> 5 then
    v_bad := v_bad || format(' ON DELETE CASCADE の外部キー=%s（5 本のはず）;', v_n);
  end if;

  -- トリガー: 4 本とも有効
  select count(*) into v_n
    from pg_trigger t
   where not t.tgisinternal
     and t.tgenabled = 'O'
     and ((t.tgrelid = 'public.task_internal_metrics'::regclass and t.tgname = 'trg_task_internal_metrics_fill_scope')
       or (t.tgrelid = 'public.space_agency_settings'::regclass and t.tgname = 'trg_space_agency_settings_fill_scope')
       or (t.tgrelid = 'public.tasks'::regclass and t.tgname = 'trg_bridge_task_actual_hours')
       or (t.tgrelid = 'public.spaces'::regclass and t.tgname = 'trg_bridge_space_agency_settings'));
  if v_n <> 4 then
    v_bad := v_bad || format(' トリガー=%s（4 本のはず）;', v_n);
  end if;

  -- 埋め戻し: 古い列に値がある行が、同じ値ですべて新しい表にある
  select count(*) into v_old from public.tasks t where t.actual_hours is not null;
  select count(*) into v_new from public.task_internal_metrics m where m.actual_hours is not null;
  select count(*) into v_n
    from public.tasks t
   where t.actual_hours is not null
     and not exists (select 1 from public.task_internal_metrics m where m.task_id = t.id and m.actual_hours = t.actual_hours);
  raise notice 'task_internal_metrics: 実績工数のある行 %（tasks.actual_hours のある行 %）', v_new, v_old;
  if v_n > 0 then
    v_bad := v_bad || format(' 実績工数の埋め戻し漏れ=%s;', v_n);
  end if;

  select count(*) into v_old
    from public.spaces s
   where s.default_margin_rate is not null
      or s.vendor_settings is distinct from '{"show_client_name": false, "allow_client_comments": false}'::jsonb;
  select count(*) into v_new from public.space_agency_settings;
  select count(*) into v_n
    from public.spaces s
   where (s.default_margin_rate is not null
          or s.vendor_settings is distinct from '{"show_client_name": false, "allow_client_comments": false}'::jsonb)
     and not exists (select 1 from public.space_agency_settings a
                      where a.space_id = s.id
                        and a.default_margin_rate is not distinct from s.default_margin_rate
                        and a.vendor_settings = s.vendor_settings);
  raise notice 'space_agency_settings: 行 %（既定値でない代理店設定のある space %）', v_new, v_old;
  if v_n > 0 then
    v_bad := v_bad || format(' 代理店設定の埋め戻し漏れ=%s;', v_n);
  end if;

  if v_bad <> '' then
    raise exception 'internal metrics agency tables: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 6）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_internal_metrics_agency_tables.sh（全 PASS）。RED=1 で本 migration 抜き。
--      scripts/verify-migrations-from-scratch.sh（新しい RLS 表の二要素ポリシー・関数の実行権の検査）。
--   1) 適用前（本番）: 埋め戻す件数を数える:
--        select count(*) from public.tasks where actual_hours is not null;
--        select count(*) from public.spaces where default_margin_rate is not null
--           or vendor_settings is distinct from '{"show_client_name": false, "allow_client_comments": false}'::jsonb;
--   2) 適用後（本番）: 節 6 の NOTICE の件数が 1) と同じ。新しい表の権限（anon に無い）と RLS:
--        select relname, relrowsecurity, relacl from pg_class
--         where oid in ('public.task_internal_metrics'::regclass, 'public.space_agency_settings'::regclass);
--   3) 画面: タスクの実績工数の入力・プロジェクト設定の代理店設定の保存が今までどおりできる（古い列に書いた値が
--      新しい表にも入る）。
-- =============================================================================
