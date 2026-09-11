-- =============================================================================
-- task_pricing の space の外部キーを ON DELETE CASCADE にそろえる
-- 確定設計: Fable 裁定 2026-09-11
--
-- 規則: space 単位の表の行は、その space を消すと一緒に消える（ON DELETE CASCADE）。
--   task_pricing の2本を、ほかの 11 表（20260911155718_space_org_fk.sql の対象）と同じ形にする:
--     task_pricing_space_id_fkey   FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
--     task_pricing_space_org_fkey  FOREIGN KEY (space_id, org_id) REFERENCES spaces(id, org_id) ON DELETE CASCADE
--   名前は変えない。ON UPDATE は既定のまま。作り直すときは NOT VALID で足してから VALIDATE CONSTRAINT で今の行を確かめる
--   （同じトランザクションの中）。task_pricing のほかの外部キー（task_id → tasks・org_id → organizations）は変えない。
--
-- 冪等: 2本とも CASCADE なら作り直さない。VALIDATE は何度流しても同じ。2回流しても同じ。
-- 可逆: 節 1 の末尾のロールバック節（既定＝NO ACTION で作り直す）。データは変えない。
-- =============================================================================


-- =============================================================================
-- 節 1: 2本を ON DELETE CASCADE で作り直し、今の行を確かめる
-- =============================================================================

-- CASCADE でないものだけ作り直す（NOT VALID: 足す時点では今の行を読まない）
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('task_pricing_space_id_fkey',  'foreign key (space_id) references public.spaces (id) on delete cascade'),
      ('task_pricing_space_org_fkey', 'foreign key (space_id, org_id) references public.spaces (id, org_id) on delete cascade')
    ) as v(conname, def)
  loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.task_pricing'::regclass
        and conname = r.conname
        and contype = 'f'
        and confdeltype = 'c'
    ) then
      execute format('alter table public.task_pricing drop constraint if exists %I', r.conname);
      execute format('alter table public.task_pricing add constraint %I %s not valid', r.conname, r.def);
    end if;
  end loop;
end $$;

-- 今の行がすべて、同じ組織の space を指していることを確かめる
alter table public.task_pricing validate constraint task_pricing_space_id_fkey;
alter table public.task_pricing validate constraint task_pricing_space_org_fkey;

-- 確認: 2本とも spaces を指し、ON DELETE CASCADE・ON UPDATE は既定・確かめ済みで、列が想定どおり（違えば止める）
do $$
declare
  v_bad text;
begin
  select string_agg(e.conname, ', ' order by e.conname)
    into v_bad
    from (values
      ('task_pricing_space_id_fkey',  array['space_id'],           array['id']),
      ('task_pricing_space_org_fkey', array['space_id', 'org_id'], array['id', 'org_id'])
    ) as e(conname, cols, refcols)
    left join pg_constraint c
      on c.conrelid = 'public.task_pricing'::regclass and c.conname = e.conname and c.contype = 'f'
   where c.oid is null
      or c.confrelid <> 'public.spaces'::regclass
      or c.confdeltype <> 'c'
      or c.confupdtype <> 'a'
      or not c.convalidated
      or c.conkey <> array(select a.attnum
                             from unnest(e.cols) with ordinality as u(col, i)
                             join pg_attribute a on a.attrelid = 'public.task_pricing'::regclass and a.attname = u.col
                            order by u.i)
      or c.confkey <> array(select a.attnum
                              from unnest(e.refcols) with ordinality as u(col, i)
                              join pg_attribute a on a.attrelid = 'public.spaces'::regclass and a.attname = u.col
                             order by u.i);

  if v_bad is not null then
    raise exception 'task pricing cascade: 次の外部キーが想定と違います（無い・spaces を指していない・ON DELETE CASCADE でない・確かめていない・列が違う）: %', v_bad;
  end if;
end $$;

-- ロールバック（節 1。既定＝NO ACTION で作り直す）:
--   alter table public.task_pricing drop constraint if exists task_pricing_space_org_fkey;
--   alter table public.task_pricing add constraint task_pricing_space_org_fkey foreign key (space_id, org_id) references public.spaces (id, org_id) not valid;
--   alter table public.task_pricing validate constraint task_pricing_space_org_fkey;
--   alter table public.task_pricing drop constraint if exists task_pricing_space_id_fkey;
--   alter table public.task_pricing add constraint task_pricing_space_id_fkey foreign key (space_id) references public.spaces (id) not valid;
--   alter table public.task_pricing validate constraint task_pricing_space_id_fkey;
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_task_pricing_cascade.sh（全 PASS）。RED=1 で本 migration 抜き。
--   1) 適用後（本番）:
--        select conname, convalidated, pg_get_constraintdef(oid) from pg_constraint
--         where conrelid = 'public.task_pricing'::regclass and contype = 'f' order by 1;
--          → task_pricing_space_id_fkey・task_pricing_space_org_fkey が ON DELETE CASCADE・convalidated = true。
--            task_pricing_task_id_fkey（CASCADE）・task_pricing_org_id_fkey（既定）は変わらない。
--   2) 見積の行がある space を service role で消すと、見積の行も一緒に消える。
--      見積の行を消すときの見張りは *_task_pricing_guard_cascade.sql で連鎖削除を通す。
-- =============================================================================
