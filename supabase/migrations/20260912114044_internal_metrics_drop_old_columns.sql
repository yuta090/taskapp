-- =============================================================================
-- 社内専用の記録を新しい表だけに置く（C3: つなぎと古い列を外す）
-- 確定設計: Fable 裁定 2026-09-11（順番は 20260912070907_internal_metrics_agency_tables.sql の冒頭のとおり）
--
-- 規則:
--   実績工数（actual_hours）は task_internal_metrics だけに、既定の利益率（default_margin_rate）と
--   協力会社向けの表示設定（vendor_settings）は space_agency_settings だけに置く。
--   tasks.actual_hours・spaces.default_margin_rate・spaces.vendor_settings は無い。
--   代理店モード（spaces.agency_mode）を決められるのは、サーバー（service_role）と、その space の役割が
--     admin / editor の人だけ（space に行が無い人は決められない）。作るときも同じ（代理店モードの space を
--     作れるのはサーバーだけ。作ってから admin / editor が切り替える）。
--   順番: ① つなぎのトリガーと関数を外す ② 見張り（guard_agency_settings）を agency_mode だけを見る本文に作り直し、
--     作るとき（insert）も見る（SECURITY DEFINER・search_path・実行権は保つ）③ 古い3列を消す（その列だけの
--     既定値と CHECK も一緒に消える）④ 古い列を名前で読む関数・ビュー・ポリシー・トリガーが無いことを、先に確かめる（節 0）。
--
-- ロック: 先頭で tasks・spaces を access exclusive でまとめて押さえてから変える（トリガーを外すのも列を消すのも、
--   表の access exclusive が要る。途中で強いロックに上げない）。待つのは 3 秒まで。取れなければ全体を取り消すので、
--   流し直す。DO 文の中で取る（空の DB から順に流す確認はトランザクションで包まないため。本番の適用は1トランザクション
--   なので、ロックは最後まで持つ）。
-- 前提: 古い列に値がある行は、新しい表でも同じ値（C2 の後は新しい表が正）。節 0 で実績工数・既定の利益率・
--   表示設定のそれぞれを確かめ、違う行が1つでもあれば止める（古い列を新しい表に合わせてから流す）。
-- 冪等: drop … if exists・create or replace。2回流しても同じ（2回目は古い列が無いので、節 0 の突き合わせは飛ばす）。
-- 不可逆: 古い3列の中身は消える（同じ値は新しい表にある）。ロールバックは、列を作り直して新しい表から写し戻す。
--   本番の適用には apply-migration.sh の --allow-destructive が要る（列を消すため）。
-- =============================================================================


-- =============================================================================
-- 節 0: ロックと、先に確かめること（何も変えない）
-- =============================================================================

do $$
begin
  set local lock_timeout = '3s';
  lock table public.tasks, public.spaces in access exclusive mode;
end $$;

-- 見張りの今の定義が、土台（20260308_002_agency_settings_write_guard.sql）か本 migration の定義と
--   1文字でも違えば止める（本番だけにある手直しを上書きしないため）
do $$
declare
  v_md5 text;
begin
  select md5(p.prosrc) into v_md5
    from pg_proc p
   where p.oid = to_regprocedure('public.guard_agency_settings()')
     and p.prosecdef
     and p.proconfig = array['search_path=public'];

  if v_md5 is null or v_md5 not in ('9784a7b9ec445571a25e80b57dfcc3e1', '0cebbb07f3cb2a0ea54f81fbde1c99b3') then
    raise exception 'drop old columns: guard_agency_settings の今の定義が、土台にした migration の定義と違います（md5=%）',
      coalesce(v_md5, '(なし)');
  end if;
end $$;

-- 古い列が残っているとき: 古い列に値がある行が、新しい表でも同じ値であること（C2 の後は新しい表が正）。
--   古い列に頼る物が、つなぎと見張りのほかに無いこと
--   （関数は public の関数の本文に列の名前があるかで見る。新しい表の同じ名前の列を読む関数も引っかかるので、
--   そのときは中身を見て直す）
do $$
declare
  v_bad  text := '';
  v_n    bigint;
  v_text text;
begin
  if exists (select 1 from pg_attribute
              where attrelid = 'public.tasks'::regclass and attname = 'actual_hours' and not attisdropped) then
    execute 'select count(*) from public.tasks t
              where t.actual_hours is not null
                and not exists (select 1 from public.task_internal_metrics m
                                 where m.task_id = t.id and m.actual_hours = t.actual_hours)'
      into v_n;
    if v_n > 0 then
      v_bad := v_bad || format(' 古い列と新しい表で実績工数（actual_hours）が違う行=%s（C2 の後は新しい表が正。古い列を新しい表に合わせてから流す）;', v_n);
    end if;
  end if;

  if (select count(*) from pg_attribute
       where attrelid = 'public.spaces'::regclass
         and attname in ('default_margin_rate', 'vendor_settings') and not attisdropped) = 2 then
    execute 'select count(*) from public.spaces s
              where s.default_margin_rate is not null
                and not exists (select 1 from public.space_agency_settings a
                                 where a.space_id = s.id and a.default_margin_rate = s.default_margin_rate)'
      into v_n;
    if v_n > 0 then
      v_bad := v_bad || format(' 古い列と新しい表で既定の利益率（default_margin_rate）が違う行=%s（C2 の後は新しい表が正。古い列を新しい表に合わせてから流す）;', v_n);
    end if;

    execute 'select count(*) from public.spaces s
              where s.vendor_settings is distinct from ''{"show_client_name": false, "allow_client_comments": false}''::jsonb
                and not exists (select 1 from public.space_agency_settings a
                                 where a.space_id = s.id and a.vendor_settings = s.vendor_settings)'
      into v_n;
    if v_n > 0 then
      v_bad := v_bad || format(' 古い列と新しい表で協力会社向けの表示設定（vendor_settings）が違う行=%s（C2 の後は新しい表が正。古い列を新しい表に合わせてから流す）;', v_n);
    end if;
  end if;

  -- 古い列に頼る物（ビュー・ポリシー・索引・トリガー・制約）が、つなぎのトリガーと、その列だけの CHECK のほかに無い
  select string_agg(distinct s.x, ', ')
    into v_text
    from (
      select case d.classid
               when 'pg_rewrite'::regclass then 'view ' || (select r.ev_class::regclass::text from pg_rewrite r where r.oid = d.objid)
               when 'pg_policy'::regclass then 'policy ' || (select p.polname::text from pg_policy p where p.oid = d.objid)
               when 'pg_trigger'::regclass then 'trigger ' || (select t.tgname::text from pg_trigger t where t.oid = d.objid)
               when 'pg_class'::regclass then 'relation ' || d.objid::regclass::text
               when 'pg_constraint'::regclass then 'constraint ' || (select c.conname::text from pg_constraint c where c.oid = d.objid)
               else d.classid::regclass::text
             end as x
        from pg_depend d
        join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
       where d.refclassid = 'pg_class'::regclass
         and d.classid <> 'pg_attrdef'::regclass
         and ((a.attrelid = 'public.tasks'::regclass and a.attname = 'actual_hours')
           or (a.attrelid = 'public.spaces'::regclass and a.attname in ('default_margin_rate', 'vendor_settings')))
    ) s
   where s.x not in ('trigger trg_bridge_task_actual_hours', 'trigger trg_bridge_space_agency_settings',
                     'constraint chk_default_margin_rate', 'constraint chk_vendor_settings');
  if v_text is not null then
    v_bad := v_bad || ' 古い列に頼る物: ' || v_text || ';';
  end if;

  -- 古い列の名前を本文に持つ関数が、つなぎと見張りのほかに無い
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into v_text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~* '(actual_hours|default_margin_rate|vendor_settings)'
     and p.oid not in (coalesce(to_regprocedure('public.bridge_task_actual_hours()'), 0),
                       coalesce(to_regprocedure('public.bridge_space_agency_settings()'), 0),
                       coalesce(to_regprocedure('public.guard_agency_settings()'), 0));
  if v_text is not null then
    v_bad := v_bad || ' 古い列の名前を本文に持つ関数: ' || v_text || ';';
  end if;

  if v_bad <> '' then
    raise exception 'drop old columns: 先に直してください:%', v_bad;
  end if;
end $$;

-- ロールバック（節 0）: なし（ロックはトランザクションの終わりで外れる。確認は何も変えない）
-- =============================================================================
-- 節 1: つなぎ（古い列 → 新しい表）のトリガーと関数を外す
-- =============================================================================

drop trigger if exists trg_bridge_task_actual_hours on public.tasks;
drop trigger if exists trg_bridge_space_agency_settings on public.spaces;
drop function if exists public.bridge_task_actual_hours();
drop function if exists public.bridge_space_agency_settings();

-- ロールバック（節 1。つなぎを作り直す。本文と実行権は 20260912070907_internal_metrics_agency_tables.sql のとおり）:
--   create or replace function public.bridge_task_actual_hours()
--     returns trigger
--     language plpgsql
--     security definer
--     set search_path = public
--   as $$
--   begin
--     if tg_op = 'UPDATE' and new.actual_hours is not distinct from old.actual_hours then
--       return null;
--     end if;
--   
--     if new.actual_hours is null then
--       -- 値を消したときは、記録の行を残して値だけ消す（行が無ければ何もしない）
--       update public.task_internal_metrics m
--          set actual_hours = null
--        where m.task_id = new.id;
--     else
--       insert into public.task_internal_metrics (task_id, org_id, space_id, actual_hours)
--       values (new.id, new.org_id, new.space_id, new.actual_hours)
--       on conflict (task_id) do update set actual_hours = excluded.actual_hours;
--     end if;
--     return null;
--   end;
--   $$;
--   
--   create or replace function public.bridge_space_agency_settings()
--     returns trigger
--     language plpgsql
--     security definer
--     set search_path = public
--   as $$
--   begin
--     if tg_op = 'INSERT' then
--       -- 既定値のまま作った space には、設定の行を作らない
--       if new.default_margin_rate is null
--          and new.vendor_settings is not distinct from '{"show_client_name": false, "allow_client_comments": false}'::jsonb then
--         return null;
--       end if;
--     elsif new.default_margin_rate is not distinct from old.default_margin_rate
--           and new.vendor_settings is not distinct from old.vendor_settings then
--       return null;
--     end if;
--   
--     insert into public.space_agency_settings (space_id, org_id, default_margin_rate, vendor_settings)
--     values (new.id, new.org_id, new.default_margin_rate, new.vendor_settings)
--     on conflict (space_id) do update
--       set default_margin_rate = excluded.default_margin_rate,
--           vendor_settings     = excluded.vendor_settings;
--     return null;
--   end;
--   $$;
--   
--   comment on function public.bridge_task_actual_hours() is
--     'つなぎ: tasks.actual_hours に書かれた値を task_internal_metrics へ写す（コードが新しい表を使うまで。後の migration で外す）';
--   
--   comment on function public.bridge_space_agency_settings() is
--     'つなぎ: spaces.default_margin_rate / vendor_settings に書かれた値を space_agency_settings へ写す（コードが新しい表を使うまで。後の migration で外す）';
--   
--   revoke all on function public.bridge_task_actual_hours() from public, anon, authenticated, service_role;
--   revoke all on function public.bridge_space_agency_settings() from public, anon, authenticated, service_role;
--   
--   create or replace trigger trg_bridge_task_actual_hours
--     after insert or update of actual_hours on public.tasks
--     for each row execute function public.bridge_task_actual_hours();
--   
--   create or replace trigger trg_bridge_space_agency_settings
--     after insert or update of default_margin_rate, vendor_settings on public.spaces
--     for each row execute function public.bridge_space_agency_settings();
-- =============================================================================
-- 節 2: 見張り（guard_agency_settings）… 代理店モードだけを見る。作るとき（insert）も見る
--   土台: 20260308_002_agency_settings_write_guard.sql（節 0 で md5 を確かめ済み）。create or replace なので、
--   実行権はそのまま。トリガーは drop せず作り直す（insert と、agency_mode を書き換える update の前に動く）。
-- =============================================================================

create or replace function public.guard_agency_settings()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  caller_role text;
begin
  -- 代理店モードを変えないなら通す（作るときは、代理店モードでなければ通す）
  if tg_op = 'INSERT' then
    if not new.agency_mode then
      return new;
    end if;
  elsif old.agency_mode is not distinct from new.agency_mode then
    return new;
  end if;

  -- サーバー（service_role）は通す
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;

  -- その space の役割が admin / editor の人だけ（space に行が無ければ止める。作るときは、まだ行が無い）
  select sm.role into caller_role
    from space_memberships sm
   where sm.space_id = new.id
     and sm.user_id = auth.uid()
   limit 1;

  if caller_role in ('admin', 'editor') then
    return new;
  end if;

  raise exception 'permission denied: only admin/editor can update agency settings';
end;
$$;

comment on function public.guard_agency_settings() is
  'spaces の代理店モード（agency_mode）を決められるのは、サーバー（service_role）と、その space の役割が admin / editor の人だけ（作るときも見る）';

create or replace trigger trg_guard_agency_settings
  before insert or update of agency_mode on public.spaces
  for each row
  execute function public.guard_agency_settings();

-- ロールバック（節 2。土台の本文と、update だけを見るトリガーに戻す）:
--   create or replace function public.guard_agency_settings()
--   returns trigger
--   language plpgsql
--   security definer
--   set search_path = public
--   as $$
--   declare
--     caller_role text;
--   begin
--     -- Allow if none of the agency columns changed
--     if old.agency_mode is not distinct from new.agency_mode
--        and old.default_margin_rate is not distinct from new.default_margin_rate
--        and old.vendor_settings is not distinct from new.vendor_settings
--     then
--       return new;
--     end if;
--   
--     -- Allow service_role (server-side operations)
--     if current_setting('role', true) = 'service_role' then
--       return new;
--     end if;
--   
--     -- Check caller's role in this space
--     select sm.role into caller_role
--       from space_memberships sm
--      where sm.space_id = new.id
--        and sm.user_id = auth.uid()
--      limit 1;
--   
--     if caller_role in ('admin', 'editor') then
--       return new;
--     end if;
--   
--     raise exception 'permission denied: only admin/editor can update agency settings';
--   end;
--   $$;
--   
--   comment on function public.guard_agency_settings() is 'Prevents non-admin/editor users from modifying agency_mode, default_margin_rate, vendor_settings';
--   
--   create or replace trigger trg_guard_agency_settings
--     before update on public.spaces
--     for each row
--     execute function public.guard_agency_settings();
-- =============================================================================
-- 節 3: 古い3列を消す（その列だけの既定値と CHECK も一緒に消える）
-- =============================================================================

alter table public.tasks drop column if exists actual_hours;
alter table public.spaces drop column if exists default_margin_rate;
alter table public.spaces drop column if exists vendor_settings;

-- ロールバック（節 3。列と CHECK を元の形で作り直し、新しい表から写し戻す。tasks・spaces の更新ではほかのトリガーも動く）:
--   alter table public.tasks add column if not exists actual_hours numeric null;
--   comment on column public.tasks.actual_hours is 'Actual hours spent on the task (entered after completion)';
--   alter table public.spaces add column if not exists default_margin_rate numeric(5,2) default null;
--   alter table public.spaces add column if not exists vendor_settings jsonb
--     not null default '{"show_client_name": false, "allow_client_comments": false}';
--   alter table public.spaces add constraint chk_default_margin_rate
--     check (default_margin_rate is null or (default_margin_rate >= 0 and default_margin_rate <= 999.99));
--   alter table public.spaces add constraint chk_vendor_settings check (
--     vendor_settings is not null
--     and jsonb_typeof(vendor_settings->'show_client_name') = 'boolean'
--     and jsonb_typeof(vendor_settings->'allow_client_comments') = 'boolean'
--   );
--   update public.tasks t set actual_hours = m.actual_hours
--     from public.task_internal_metrics m
--    where m.task_id = t.id and m.actual_hours is not null;
--   update public.spaces s set default_margin_rate = a.default_margin_rate, vendor_settings = a.vendor_settings
--     from public.space_agency_settings a
--    where a.space_id = s.id;
-- =============================================================================
-- 節 4: 末尾の確認（何も変えない）… 古い列とつなぎが無く、見張りが想定どおりで、古い列の名前を本文に持つ関数が無い。
--   違えば止める。
-- =============================================================================

do $$
declare
  v_bad  text := '';
  v_n    bigint;
  v_text text;
begin
  -- 古い3列が無い
  select string_agg(c.relname || '.' || a.attname, ', ' order by c.relname, a.attname)
    into v_text
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
   where not a.attisdropped
     and ((c.oid = 'public.tasks'::regclass and a.attname = 'actual_hours')
       or (c.oid = 'public.spaces'::regclass and a.attname in ('default_margin_rate', 'vendor_settings')));
  if v_text is not null then
    v_bad := v_bad || ' 残っている古い列: ' || v_text || ';';
  end if;

  -- つなぎのトリガーと関数が無い
  select count(*) into v_n
    from pg_trigger
   where tgname in ('trg_bridge_task_actual_hours', 'trg_bridge_space_agency_settings')
     and not tgisinternal;
  if v_n > 0
     or to_regprocedure('public.bridge_task_actual_hours()') is not null
     or to_regprocedure('public.bridge_space_agency_settings()') is not null then
    v_bad := v_bad || ' つなぎが残っている;';
  end if;

  -- 見張り: 本 migration の本文・SECURITY DEFINER・search_path = public。insert と agency_mode の update の前に動く
  select format('%s:%s:%s', md5(p.prosrc), p.prosecdef::text, coalesce(array_to_string(p.proconfig, ';'), ''))
    into v_text
    from pg_proc p
   where p.oid = to_regprocedure('public.guard_agency_settings()');
  if v_text is distinct from '0cebbb07f3cb2a0ea54f81fbde1c99b3:true:search_path=public' then
    v_bad := v_bad || ' 見張りの関数: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  select count(*) into v_n
    from pg_trigger t
   where t.tgrelid = 'public.spaces'::regclass
     and t.tgname = 'trg_guard_agency_settings'
     and not t.tgisinternal
     and t.tgenabled = 'O'
     and t.tgfoid = to_regprocedure('public.guard_agency_settings()')
     and pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE OF agency_mode ON public.spaces FOR EACH ROW%';
  if v_n <> 1 then
    v_bad := v_bad || ' 見張りのトリガーの形;';
  end if;

  -- 古い列の名前を本文に持つ public の関数が無い
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into v_text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~* '(actual_hours|default_margin_rate|vendor_settings)';
  if v_text is not null then
    v_bad := v_bad || ' 古い列の名前を本文に持つ関数: ' || v_text || ';';
  end if;

  if v_bad <> '' then
    raise exception 'drop old columns: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 4）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_internal_metrics_drop_old_columns.sh（全 PASS）。RED=1 で本 migration 抜き。
--      scripts/verify-migrations-from-scratch.sh
--   1) 適用前（本番・読むだけ）: 古い列と新しい表で値が違う行が、実績工数・既定の利益率・表示設定のどれも 0 件:
--        select count(*) from public.tasks t where t.actual_hours is not null
--           and not exists (select 1 from public.task_internal_metrics m where m.task_id = t.id and m.actual_hours = t.actual_hours);
--        select count(*) from public.spaces s where s.default_margin_rate is not null
--           and not exists (select 1 from public.space_agency_settings a where a.space_id = s.id and a.default_margin_rate = s.default_margin_rate);
--        select count(*) from public.spaces s
--         where s.vendor_settings is distinct from '{"show_client_name": false, "allow_client_comments": false}'::jsonb
--           and not exists (select 1 from public.space_agency_settings a where a.space_id = s.id and a.vendor_settings = s.vendor_settings);
--      見張りの今の本文が土台と同じ:
--        select md5(prosrc) from pg_proc where oid = 'public.guard_agency_settings()'::regprocedure;  → 9784a7b9ec445571a25e80b57dfcc3e1
--   2) 適用後（本番）: 節 4 が通る。
--   3) 画面: タスクの実績工数の入力・プロジェクト設定の代理店設定（利益率・協力会社向けの表示・代理店モードの切り替え）が
--      今までどおり保存できる。
-- =============================================================================
