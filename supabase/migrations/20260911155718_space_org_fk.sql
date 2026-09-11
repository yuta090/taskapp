-- =============================================================================
-- space 単位の表の行は、同じ組織の space だけを指す
-- 確定設計: Fable 裁定 2026-09-11
-- 依存: 20260710204722_channel_plumbing.sql（spaces_id_org_unique = spaces (id, org_id) の一意の索引）を先に適用。
--
-- 規則: 次の 12 表の行の (space_id, org_id) は、spaces の (id, org_id) にある組み合わせだけ（外部キー）。
--   service role を含むすべての書き込みに効く。
--   対象 = space_id と org_id を両方持つ space 単位の表（20260703_004_rls_space_scoped.sql の表から spaces を除いたもの
--   ＋ tasks ＋ task_comments）:
--     tasks / milestones / meetings / reviews / task_owners / task_pricing / task_events / task_relations /
--     wiki_pages / discussion_items / meeting_participants / task_comments
--   channel_* の表は同じ形の外部キーを既に持つ。
--
-- 外部キーの形: foreign key (space_id, org_id) references public.spaces (id, org_id)。名前は <表>_space_org_fkey。
--   ON DELETE は、その表の space_id の外部キー（<表>_space_id_fkey）と同じ（task_pricing は既定＝NO ACTION、ほかは CASCADE）。
--   ON UPDATE は既定（NO ACTION）。space_id の外部キーは残す。
--   NOT VALID で足してから VALIDATE CONSTRAINT で今の行を確かめる（同じトランザクションの中）。
--
-- 冪等: 外部キーが無いときだけ足す／VALIDATE は何度流しても同じ。2回流しても同じ。
-- 可逆: 節 1 の末尾のロールバック節（外部キーを drop・表ごとに戻せる）。データは変えない。
-- =============================================================================


-- =============================================================================
-- 節 0: 適用前の確認 — 行の org_id と、その space の組織が違う行があれば止める（何も変えない）
-- =============================================================================

do $$
declare
  v_bad text := '';
  v_n bigint;
  t text;
begin
  foreach t in array array['tasks', 'milestones', 'meetings', 'reviews', 'task_owners', 'task_pricing', 'task_events',
                           'task_relations', 'wiki_pages', 'discussion_items', 'meeting_participants', 'task_comments'] loop
    execute format(
      'select count(*) from public.%I x join public.spaces s on s.id = x.space_id where s.org_id <> x.org_id', t)
      into v_n;
    if v_n > 0 then
      v_bad := v_bad || format(' %s=%s', t, v_n);
    end if;
  end loop;

  if v_bad <> '' then
    raise exception 'space org fk: 行の org_id と、その space の組織が違う行があります。直してから流してください:%', v_bad;
  end if;
end $$;

-- ロールバック（節 0）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 節 1: 12 表に (space_id, org_id) → spaces (id, org_id) の外部キーを足し、今の行を確かめる
-- =============================================================================

-- 外部キーが無い表にだけ足す（NOT VALID: 足す時点では今の行を読まない）
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('tasks',                'on delete cascade'),
      ('milestones',           'on delete cascade'),
      ('meetings',             'on delete cascade'),
      ('reviews',              'on delete cascade'),
      ('task_owners',          'on delete cascade'),
      ('task_pricing',         ''),                   -- space_id の外部キーと同じく既定（NO ACTION）
      ('task_events',          'on delete cascade'),
      ('task_relations',       'on delete cascade'),
      ('wiki_pages',           'on delete cascade'),
      ('discussion_items',     'on delete cascade'),
      ('meeting_participants', 'on delete cascade'),
      ('task_comments',        'on delete cascade')
    ) as v(tbl, on_delete)
  loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', r.tbl)::regclass
        and conname = r.tbl || '_space_org_fkey'
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (space_id, org_id) references public.spaces (id, org_id) %s not valid',
        r.tbl, r.tbl || '_space_org_fkey', r.on_delete);
    end if;
  end loop;
end $$;

-- 今の行がすべて同じ組織の space を指していることを確かめる
alter table public.tasks validate constraint tasks_space_org_fkey;
alter table public.milestones validate constraint milestones_space_org_fkey;
alter table public.meetings validate constraint meetings_space_org_fkey;
alter table public.reviews validate constraint reviews_space_org_fkey;
alter table public.task_owners validate constraint task_owners_space_org_fkey;
alter table public.task_pricing validate constraint task_pricing_space_org_fkey;
alter table public.task_events validate constraint task_events_space_org_fkey;
alter table public.task_relations validate constraint task_relations_space_org_fkey;
alter table public.wiki_pages validate constraint wiki_pages_space_org_fkey;
alter table public.discussion_items validate constraint discussion_items_space_org_fkey;
alter table public.meeting_participants validate constraint meeting_participants_space_org_fkey;
alter table public.task_comments validate constraint task_comments_space_org_fkey;

-- 確認: 12 表とも外部キーがあり、確かめ済みで、ON DELETE が space_id の外部キーと同じ（違えば止める）
do $$
declare
  v_bad text;
begin
  select string_agg(t.tbl, ', ' order by t.tbl)
    into v_bad
    from unnest(array['tasks', 'milestones', 'meetings', 'reviews', 'task_owners', 'task_pricing', 'task_events',
                      'task_relations', 'wiki_pages', 'discussion_items', 'meeting_participants', 'task_comments']) as t(tbl)
    left join pg_constraint n
      on n.conrelid = format('public.%I', t.tbl)::regclass
     and n.conname = t.tbl || '_space_org_fkey'
    left join pg_constraint o
      on o.conrelid = format('public.%I', t.tbl)::regclass
     and o.contype = 'f'
     and o.confrelid = 'public.spaces'::regclass
     and o.conkey = array[(select a.attnum from pg_attribute a
                           where a.attrelid = format('public.%I', t.tbl)::regclass and a.attname = 'space_id')]
   where n.oid is null
      or not n.convalidated
      or o.oid is null
      or n.confdeltype <> o.confdeltype;

  if v_bad is not null then
    raise exception 'space org fk: 次の表の外部キーが想定と違います（無い・確かめていない・ON DELETE が space_id の外部キーと違う）: %', v_bad;
  end if;
end $$;

-- ロールバック（節 1。表ごとに戻せる＝その表の1行だけ流してもよい）:
--   alter table public.tasks drop constraint if exists tasks_space_org_fkey;
--   alter table public.milestones drop constraint if exists milestones_space_org_fkey;
--   alter table public.meetings drop constraint if exists meetings_space_org_fkey;
--   alter table public.reviews drop constraint if exists reviews_space_org_fkey;
--   alter table public.task_owners drop constraint if exists task_owners_space_org_fkey;
--   alter table public.task_pricing drop constraint if exists task_pricing_space_org_fkey;
--   alter table public.task_events drop constraint if exists task_events_space_org_fkey;
--   alter table public.task_relations drop constraint if exists task_relations_space_org_fkey;
--   alter table public.wiki_pages drop constraint if exists wiki_pages_space_org_fkey;
--   alter table public.discussion_items drop constraint if exists discussion_items_space_org_fkey;
--   alter table public.meeting_participants drop constraint if exists meeting_participants_space_org_fkey;
--   alter table public.task_comments drop constraint if exists task_comments_space_org_fkey;
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_space_org_fk.sh（全 PASS）。
--      RED=1 を付けると本 migration を流さずに同じ assert を回し、chg_* / same_* の区分けが合っていることを確かめられる。
--   1) 適用後（本番）:
--        select conrelid::regclass, convalidated, pg_get_constraintdef(oid) from pg_constraint
--         where contype = 'f' and conname like '%\_space\_org\_fkey' order by 1;     → 12 表・convalidated はすべて true
--   2) 画面: タスク・会議・Wiki・マイルストーン・コメントの作成と、プロジェクトの削除（その中の行が消える）。
-- =============================================================================
