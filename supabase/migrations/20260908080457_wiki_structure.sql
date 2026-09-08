-- =============================================================================
-- wiki_pages に「ピン留め / フォルダ(親子) / マイルストーン紐づけ」の列を追加する
-- 対象テーブル: public.wiki_pages（列追加のみ・新規テーブルなし・RLS 変更なし）
-- SPEC: docs/spec/WIKI_LIST_SPEC.md「PR2: 構造（ピン留め・フォルダ・マイルストーン）」
-- =============================================================================
--
-- 目的:
--   Wiki 一覧を「ピン留め＝常に先頭」「フォルダ＝親子ツリー」「マイルストーン別」で
--   引けるようにするための器（列）を用意する。UI / hooks / CLI は別 PR。
--
-- 追加する列（すべて NULL 許容・既定 NULL ＝ 既存行の意味は一切変わらない）:
--   parent_page_id  親ページ。親が消えたら子は孤児にせず根に上げる（on delete set null）
--   milestone_id    紐づけるマイルストーン。マイルストーンが消えたら紐づけだけ外す
--   pinned_at       ピン留めした時刻。非 NULL なら一覧の先頭（複数あれば古い順）
--   sort_order      同じ階層内の手動並び順。NULL は「未指定」＝既定順にフォールバック
--
-- マルチテナント境界:
--   行そのものは既存 RLS（app_can_access_space(space_id, org_id)）が守るため
--   policy の追加・変更は不要。GRANT も列単位ではなくテーブル単位で付いている
--   （supabase/migrations/20260703_000_rls_stage0_grants.sql）ので追加 GRANT も不要。
--
--   ただし RLS が見るのは「どの行を触れるか」だけで、「列の中身が別 space を指していないか」
--   は見ない。そこで BEFORE INSERT OR UPDATE トリガーで次を検証して拒否する:
--     1) parent_page_id は同じ org_id / space_id のページであること
--     2) 自分自身を親にできない・祖先をたどって自分に戻る循環を作れないこと
--     3) milestone_id は同じ org_id / space_id のマイルストーンであること
--   RLS＝誰が書けるか / トリガー＝何を書けるか、という責務分離。既存の
--   supabase/migrations/20260720181730_connector_import_config_validation.sql と同じ型で、
--   REST・RPC・SQL のどの書込経路からも同じ不変条件がかかる。
--
-- 冪等性:
--   列は add column if not exists、索引は create index if not exists、
--   関数は create or replace、トリガーは drop if exists → create。再実行しても安全。
--
-- ロールバック（ほぼ全て可逆。不可逆点は 1 か所だけ）:
--   -- 検証だけ外す（完全に可逆）
--   drop trigger if exists trg_enforce_wiki_page_parent on public.wiki_pages;
--   drop function if exists public.enforce_wiki_page_parent();
--   drop index if exists public.wiki_pages_parent_idx;
--   drop index if exists public.wiki_pages_milestone_idx;
--   -- 列ごと戻す（⚠ 不可逆）
--   alter table public.wiki_pages
--     drop column if exists parent_page_id,
--     drop column if exists milestone_id,
--     drop column if exists pinned_at,
--     drop column if exists sort_order;
--   ⚠ 列を drop すると、そこに入っていた親子関係・マイルストーン紐づけ・ピン留めの
--     情報は失われて元に戻せない。これがこの migration で唯一の不可逆な操作。
--     トリガー／索引だけを落とす分には既存データは無傷。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) 列追加
-- -----------------------------------------------------------------------------
alter table public.wiki_pages
  add column if not exists parent_page_id uuid null references public.wiki_pages(id) on delete set null,
  add column if not exists milestone_id   uuid null references public.milestones(id) on delete set null,
  add column if not exists pinned_at      timestamptz null,
  add column if not exists sort_order     int null;

comment on column public.wiki_pages.parent_page_id is '親ページ（フォルダ表示用）。同一 org/space のページのみ。親削除時は NULL（根に上がる）';
comment on column public.wiki_pages.milestone_id   is '紐づけるマイルストーン。同一 org/space のみ。マイルストーン削除時は NULL';
comment on column public.wiki_pages.pinned_at      is 'ピン留めした時刻。非 NULL なら一覧の先頭に固定（複数は古い順）';
comment on column public.wiki_pages.sort_order     is '同一階層内の手動並び順。NULL は未指定（既定順にフォールバック）';

-- -----------------------------------------------------------------------------
-- 2) 索引
--    - 親での引き当ては必ず space 単位で行うため (space_id, parent_page_id) の複合。
--    - マイルストーン別表示は紐づけ済みの行しか見ないため部分索引で十分。
-- -----------------------------------------------------------------------------
create index if not exists wiki_pages_parent_idx
  on public.wiki_pages(space_id, parent_page_id);

create index if not exists wiki_pages_milestone_idx
  on public.wiki_pages(milestone_id)
  where milestone_id is not null;

-- -----------------------------------------------------------------------------
-- 3) 境界・循環の検証トリガー
--
--    security invoker のまま（RLS の中で動けばよい）。呼び出したユーザーから見えない
--    ページを親に指定した場合は「見つからない」＝別スペース扱いで拒否されるので、
--    可視性の穴にはならない。親は必ず同じ space なので、祖先チェーンも同じ space に
--    閉じており、RLS で途中が見えなくなって循環を見落とすことはない。
-- -----------------------------------------------------------------------------
create or replace function public.enforce_wiki_page_parent()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_parent_org   uuid;
  v_parent_space uuid;
  v_has_cycle    boolean;
  v_too_deep     boolean;
begin
  -- ホットパス素通し: 本文の自動保存など、境界に関わる列が変わらない UPDATE では検証しない。
  -- is not distinct from で NULL 同士も等価に扱う。
  if tg_op = 'UPDATE'
     and new.parent_page_id is not distinct from old.parent_page_id
     and new.milestone_id   is not distinct from old.milestone_id
     and new.org_id         is not distinct from old.org_id
     and new.space_id       is not distinct from old.space_id then
    return new;
  end if;

  if new.parent_page_id is not null then
    -- 自分自身を親にはできない（長さ 1 の循環）
    if new.parent_page_id = new.id then
      raise exception 'wiki parent cycle detected';
    end if;

    -- 親は同じ org / space のページであること。
    -- for share で親の行を掴み、同時に「互いを親にする」2つの更新が両方通って
    -- 循環が残る隙間（各々コミット前の状態しか見えない）を閉じる。
    select p.org_id, p.space_id
      into v_parent_org, v_parent_space
      from public.wiki_pages p
     where p.id = new.parent_page_id
       for share;

    if not found
       or v_parent_org is distinct from new.org_id
       or v_parent_space is distinct from new.space_id then
      raise exception 'wiki parent must be in the same space';
    end if;

    -- 祖先をたどって自分に戻らないこと（深さ上限 50）。
    -- 上限に達してもまだ親が続く場合は「深すぎる」として拒否する
    -- （そのまま通すと循環を見落とす可能性があるため）。
    select coalesce(bool_or(a.id = new.id), false),
           coalesce(bool_or(a.depth >= 50 and a.parent_page_id is not null), false)
      into v_has_cycle, v_too_deep
      from (
        with recursive ancestors as (
          select p.id, p.parent_page_id, 1 as depth
            from public.wiki_pages p
           where p.id = new.parent_page_id
          union all
          select p.id, p.parent_page_id, a.depth + 1
            from public.wiki_pages p
            join ancestors a on p.id = a.parent_page_id
           where a.depth < 50
        )
        select id, parent_page_id, depth from ancestors
      ) a;

    if v_has_cycle then
      raise exception 'wiki parent cycle detected';
    end if;

    if v_too_deep then
      raise exception 'wiki parent chain too deep (max 50)';
    end if;
  end if;

  if new.milestone_id is not null then
    if not exists (
      select 1
        from public.milestones m
       where m.id = new.milestone_id
         and m.org_id = new.org_id
         and m.space_id = new.space_id
    ) then
      raise exception 'wiki milestone must be in the same space';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_wiki_page_parent on public.wiki_pages;

create trigger trg_enforce_wiki_page_parent
  before insert or update on public.wiki_pages
  for each row
  execute function public.enforce_wiki_page_parent();
