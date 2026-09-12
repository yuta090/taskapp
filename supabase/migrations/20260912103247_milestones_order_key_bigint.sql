-- =============================================================================
-- マイルストーンの並び順（milestones.order_key）は bigint
--
-- 規則:
--   order_key は bigint。ミリ秒の時刻（Date.now()）も秒の時刻もそのまま入る。並びは今までどおり order_key の昇順。
--   既にある値は変えない。
--   この列の型に頼っている物は無い: ビュー v_client_milestones は order_key を使わない／索引・既定値・CHECK
--   （milestones_date_order は日付だけを見る）にも無い／関数の引数と戻りの型・%TYPE・行の型にも無い。
--   プリセットの RPC（rpc_create_space_with_preset・rpc_apply_preset_to_space）は order_key を numeric で受け取って
--   入れるので、bigint にもそのまま入る。
--
-- ロック: 先頭で milestones を access exclusive で押さえてから型を変える（型を変えると表を書き直す）。待つのは 3 秒まで。
--   取れなければ全体を取り消すので、流し直す。DO 文の中で取る（空の DB から順に流す確認はトランザクションで包まないため。
--   本番の適用は1トランザクションなので、ロックは最後まで持つ）。
-- 冪等: すでに bigint なら、型の変更は表を書き直さない。2回流しても同じ。
-- 可逆: 節 1 の末尾のロールバック節（値がすべて integer に収まるときだけ戻せる。収まらない値があると 22003 で止まる）。
--   画面から作るとミリ秒の値が入るので、int に戻すときは先に space ごとに今の並びのまま 1, 2, 3… に振り直してから型を戻す。
-- =============================================================================


-- =============================================================================
-- 節 0: ロック
-- =============================================================================

do $$
begin
  set local lock_timeout = '3s';
  lock table public.milestones in access exclusive mode;
end $$;

-- ロールバック（節 0）: なし（ロックはトランザクションの終わりで外れる）
-- =============================================================================
-- 節 1: order_key を bigint に
-- =============================================================================

alter table public.milestones alter column order_key type bigint;

-- ロールバック（節 1。値がすべて integer に収まるときだけ。収まらない値があると 22003 で止まる）:
--   alter table public.milestones alter column order_key type integer;
-- =============================================================================
-- 節 2: 末尾の確認（何も変えない）… order_key が bigint で、空を許すまま・既定値なしのまま。違えば止める。
-- =============================================================================

do $$
declare
  v_text text;
begin
  select format('%s:%s:%s', format_type(a.atttypid, a.atttypmod), (not a.attnotnull)::text, (d.adbin is null)::text)
    into v_text
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.milestones'::regclass
     and a.attname = 'order_key'
     and not a.attisdropped;
  if v_text is distinct from 'bigint:true:true' then
    raise exception 'milestones order_key bigint: 想定と違います: %', coalesce(v_text, '(列なし)');
  end if;
end $$;

-- ロールバック（節 2）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_milestones_order_key_bigint.sh（全 PASS）。RED=1 で本 migration 抜き。
--      scripts/verify-migrations-from-scratch.sh
--   1) 適用前（本番・読むだけ）: 型と値の幅、この列に頼っている物が無いこと:
--        select format_type(atttypid, atttypmod) from pg_attribute
--         where attrelid = 'public.milestones'::regclass and attname = 'order_key';          → integer
--        select count(*), min(order_key), max(order_key) from public.milestones;
--        select count(*) from pg_depend
--         where refclassid = 'pg_class'::regclass and refobjid = 'public.milestones'::regclass
--           and refobjsubid = (select attnum from pg_attribute
--                               where attrelid = 'public.milestones'::regclass and attname = 'order_key');  → 0
--   2) 適用後（本番）: 節 2 が通る。値は 1) と同じ。
--   3) 画面: プロジェクト設定・タスク作成の中でマイルストーンを追加でき、並びが今までどおり。
-- =============================================================================
