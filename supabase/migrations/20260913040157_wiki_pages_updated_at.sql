-- =============================================================================
-- wiki_pages.updated_at を update のたびに進める
--
-- いま `wiki_pages.updated_at` は insert 時の default now() だけで、本文を書き換えても
-- 進まない（唯一の例外は `rpc_set_spec_state` が明示的に now() を書く経路）。そのため:
--   1) Wiki 一覧の「更新日」列と「更新日で並べ替え」が、実際には作成日・作成順になっている
--      （src/components/wiki/WikiPageRow.tsx・src/lib/hooks/useWikiPages.ts の order）
--   2) 議事録（meetings）と同じ形の楽観ロック（update … where updated_at = 基準）を
--      Wiki の保存に入れようとしても、値が動かないので常に一致して**何も守らない**
-- この2つの土台として、meetings と同じトリガーを wiki_pages にも置く。
--
-- 型どり: supabase/migrations/20260912112247_meeting_minutes_editing.sql の
--         meetings_set_updated_at / trg_meetings_set_updated_at。
--
-- 行の中身は書き換えない（DDL だけ）。
-- =============================================================================

-- =============================================================================
-- 節 1: ロック
--
-- 既存の表にトリガーを足すので、途中で強いロックへ上げて deadlock にならないよう
-- 先に取る。`create trigger` が要るのは share row exclusive までなので、
-- access exclusive（`drop trigger` が要る強さ）は取らない。節 2 では drop せず
-- 「無いときだけ作る」形にして、この弱いロックで足りるようにしている。
-- =============================================================================

do $$
begin
  set local lock_timeout = '3s';
  lock table public.wiki_pages in share row exclusive mode;
end $$;

-- ロールバック（節 1）: なし（ロックはトランザクションの終わりで外れる）

-- =============================================================================
-- 節 2: update のたびに updated_at を now() にするトリガー
-- =============================================================================

create or replace function public.wiki_pages_set_updated_at()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.wiki_pages_set_updated_at() is
  'wiki_pages のトリガー: update のたびに updated_at を now() にする（一覧の更新日を実際の更新に合わせ、保存の楽観ロックの土台にするため）';

-- トリガー専用。直接は実行させない（トリガーとしての実行には実行権は要らない）
revoke all on function public.wiki_pages_set_updated_at() from public, anon, authenticated, service_role;

do $$
begin
  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.wiki_pages'::regclass
       and tgname = 'trg_wiki_pages_set_updated_at'
       and not tgisinternal
  ) then
    create trigger trg_wiki_pages_set_updated_at
      before update on public.wiki_pages
      for each row execute function public.wiki_pages_set_updated_at();
  end if;
end $$;

-- ロールバック（節 2。トリガーと関数を外す。行の中身は変えない。本番では
-- `drop trigger` に access exclusive が要るので、先に
-- `lock table public.wiki_pages in access exclusive mode;` を取って流す）:
--   drop trigger if exists trg_wiki_pages_set_updated_at on public.wiki_pages;
--   drop function if exists public.wiki_pages_set_updated_at();
