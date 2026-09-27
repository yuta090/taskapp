-- =============================================================================
-- 投票ブロック PR3（DB 部分）: 相手先（ポータル）も投票を読める・押せる・合図のチャネルに入れる
-- 確定設計: docs/spec/DOC_VOTE_SPEC.md §4.2・§6（Fable 裁定 2026-09-26）
-- 依存: 20260926083057_doc_polls.sql（app_can_read_doc_poll）,
--       20260926114116_doc_vote_signal.sql（app_can_join_doc_vote_signal）,
--       20260911143112_space_role_boundary.sql（wiki_pages / meetings の読み取りポリシーの条件）
--
-- 決まり: 投票を読める人＝押せる人＝その文書を読める人。条件は、ポータルの各画面が今使っている
--   文書の読み取りポリシー（wiki_pages_select_member / meetings_select_member）をそのまま写す。
--   新しい条件は作らない。
--     議事録: 社内（app_is_space_internal）、または space に入れる人（app_can_access_space）で
--             会議が 進行中・終了（予定の会議は相手先に見えない）
--     Wiki  : 社内、または space に入れる人で、公開中のマイルストーンに公開したページ
--             （ポータルに出るのは公開時点の控えだが、中の投票の番号は元のページのもの）
--   ただし Wiki の投票は、相手先には投票1つずつで絞る（レビュー指摘・2026-09-26）。
--     相手先に見えるのは公開した控え（published_body）だけなので、文書単位で許すと、公開のあとに
--     社内が元ページへ足した投票（社内だけの相談）の名前・メモまで直接の問い合わせで読めてしまう。
--     そこで「公開中の控えに載っていて、今の元ページにも残っている投票」だけにする
--     （元ページから消した投票は社内に見えないので、相手先が押し続けても誰も気づけない）。
--     判定は本文に投票の番号（uuid の文字列）が含まれるか。uuid は乱数なので部分一致で誤らない。
--
-- 触るもの: 判定関数 app_can_read_doc_source を新設し、app_can_read_doc_poll と
--   app_can_join_doc_vote_signal の中身をこれに置き換えるだけ。表・ポリシー・rpc_doc_vote_cast は変えない
--   （rpc_doc_vote_cast は app_can_read_doc_poll と mfa_satisfied を呼んでいるので、そのまま相手先も押せる）。
--   作るのは社内の編集者だけ（rpc_doc_poll_create は変えない）。
-- 冪等: create or replace function。ロックの要るものは無い（関数の置き換えだけ）。
-- 戻し方: 末尾のコメント（2本の関数を社内だけの形に戻す）。
-- =============================================================================

set lock_timeout = '3s';

-- -----------------------------------------------------------------------------
-- 1) その文書（Wiki ページ・会議）を読めるか
-- -----------------------------------------------------------------------------
create or replace function public.app_can_read_doc_source(p_wiki_page_id uuid, p_meeting_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select case
    when p_wiki_page_id is not null then exists (
      select 1
        from wiki_pages w
       where w.id = p_wiki_page_id
         and (
           public.app_is_space_internal(w.space_id, w.org_id)
           or (
             public.app_can_access_space(w.space_id, w.org_id)
             and exists (
               select 1
                 from wiki_page_publications p
                 join milestone_publications mp on mp.milestone_id = p.milestone_id
                where p.source_page_id = w.id
                  and mp.is_published
             )
           )
         )
    )
    when p_meeting_id is not null then exists (
      select 1
        from meetings m
       where m.id = p_meeting_id
         and (
           public.app_is_space_internal(m.space_id, m.org_id)
           or (public.app_can_access_space(m.space_id, m.org_id) and m.status in ('in_progress', 'ended'))
         )
    )
    else false
  end;
$$;

comment on function public.app_can_read_doc_source(uuid, uuid) is
  'RLS補助: その Wiki ページ・会議を読めるか。wiki_pages_select_member / meetings_select_member と同じ条件（社内、または相手先で公開済みのページ・進行中/終了の会議）。投票の読める範囲と合図のチャネルが使う（DOC_VOTE_SPEC §4.2）';

revoke all on function public.app_can_read_doc_source(uuid, uuid) from public, anon, service_role;
grant execute on function public.app_can_read_doc_source(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) 投票を読めるか（＝押せるか）: 文書を読めるか、に置き換える
-- -----------------------------------------------------------------------------
create or replace function public.app_can_read_doc_poll(p_poll uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
      from doc_polls p
     where p.id = p_poll
       and (
         -- 議事録: 会議を読める人（控えは無く、読める人は本文ごと読める）
         (p.meeting_id is not null and public.app_can_read_doc_source(null, p.meeting_id))
         -- Wiki（社内）: ページを読めれば全部
         or exists (
           select 1 from wiki_pages w
            where w.id = p.wiki_page_id
              and public.app_is_space_internal(w.space_id, w.org_id)
         )
         -- Wiki（相手先）: 公開中の控えに載っていて、今の元ページにも残っている投票だけ
         or exists (
           select 1 from wiki_pages w
            where w.id = p.wiki_page_id
              and public.app_can_access_space(w.space_id, w.org_id)
              -- 本文を走査する条件は、安い条件（space・公開中か）で絞ったあとに置く
              and exists (
                select 1
                  from wiki_page_publications pub
                  join milestone_publications mp on mp.milestone_id = pub.milestone_id
                 where pub.source_page_id = w.id
                   and mp.is_published
                   and position(p.id::text in pub.published_body) > 0
              )
              and position(p.id::text in w.body) > 0
         )
       )
  );
$$;

comment on function public.app_can_read_doc_poll(uuid) is
  'RLS補助: その投票を読めるか（＝押せるか）。社内は文書を読めれば全部。相手先は進行中/終了の会議の投票と、Wiki は公開中の控えに載っていて今の元ページにも残っている投票だけ（DOC_VOTE_SPEC §4.2）';

-- -----------------------------------------------------------------------------
-- 3) 合図のチャネルに入れるか: 同じく文書を読めるか＋二要素認証
-- -----------------------------------------------------------------------------
create or replace function public.app_can_join_doc_vote_signal(p_topic text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
           -- 形が合うときだけ uuid に変える（合わなければ変えずに false）
           when p_topic ~ '^meeting-minutes-view:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
             public.app_can_read_doc_source(null, substr(p_topic, length('meeting-minutes-view:') + 1)::uuid)
             and public.mfa_satisfied()
           when p_topic ~ '^wiki-page-view:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
             public.app_can_read_doc_source(substr(p_topic, length('wiki-page-view:') + 1)::uuid, null)
             and public.mfa_satisfied()
           else false
         end;
$$;

comment on function public.app_can_join_doc_vote_signal(text) is
  '投票の合図のチャネル（meeting-minutes-view:<会議ID> / wiki-page-view:<ページID>）に入れるか。その文書を読める人（app_can_read_doc_source。相手先を含む）＋二要素認証の条件。DOC_VOTE_SPEC §6';

reset lock_timeout;

-- =============================================================================
-- 適用後の確認（本番で読むだけ）:
--   select has_function_privilege('anon', 'public.app_can_read_doc_source(uuid, uuid)', 'execute');  → false
--   select pg_get_functiondef('public.app_can_read_doc_poll(uuid)'::regprocedure) like '%app_can_read_doc_source%';  → true
--
-- 戻し方（相手先を外して社内だけに戻す）:
--   create or replace function public.app_can_read_doc_poll(p_poll uuid) returns boolean language sql stable
--     security definer set search_path = public as $f$
--     select exists (select 1 from doc_polls p where p.id = p_poll and public.app_is_space_internal(p.space_id, p.org_id)); $f$;
--   app_can_join_doc_vote_signal は 20260926114116_doc_vote_signal.sql の定義を流し直す。
--   そのあと drop function if exists public.app_can_read_doc_source(uuid, uuid);
-- =============================================================================
