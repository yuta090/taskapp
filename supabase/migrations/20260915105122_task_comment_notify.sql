-- =============================================================================
-- タスクにコメントが付いたら、関係する人の受信トレイにお知らせ（mention / comment_added）を作る。
-- コメントを消したら、そのお知らせを受信トレイから消す
--
-- 問題（2026-09-15）:
--   タスクにコメントを書いても、飛ぶのは Slack のチャンネル通知（既定オフ）だけで、受信トレイ（notifications）には
--   何も届かなかった。担当者・社内承認の承認者・それまでにコメントした人・@で名指しされた人が、返事に気づけない。
--   コメントは、画面（src/lib/hooks/useTaskComments.ts）がログインした人のまま直接 insert し、相手先ポータルの
--   差し戻し（src/app/api/portal/tasks/[taskId]/route.ts）は service role で insert する。経路ごとに作ると漏れるので、
--   DB のトリガーで作る。
--
-- 対応:
--   節 1: task_comments と notifications をロックする（列・トリガー・索引を足す間、コメントの読み書きとお知らせの書き込みを
--         待たせる。お知らせの読み取りは止めない。待つのは 3 秒まで）
--   節 2: task_comments.mention_user_ids（uuid[]・既定 '{}'・20人まで）を足す。画面が @ で名指しした人を入れる
--   節 3: app_task_comment_visible_to_user … その人がそのコメントを読めるか。task_comments の読み取りのポリシー
--         （task_comments_select）を、ログインした人ではなく指定した人について判定する。service_role だけが実行できる
--   節 4: app_task_comment_notify … task_comments の AFTER INSERT（行ごと）で動き、お知らせを作る
--         - 宛先（重複なし）: 担当者（tasks.assignee_id）・取り消していない依頼の承認者（review_approvals。state は問わない）・
--           同じタスクの消していないほかのコメントの書き手・mention_user_ids
--         - 除く: 書いた本人・そのコメントを読めない人（節 3）
--         - 1コメント×1人で1行: channel = 'in_app'・dedupe_key = 'task_comment:<コメントの id>'・重なったら何もしない
--         - type: 名指しされた人は 'mention'、ほかは 'comment_added'（両方に当たる人は mention の1行だけ）
--         - payload: task_id / task_title / comment_id / from_user_name（書いた人の表示名。無いか空なら null）/
--           title / message（コメント本文の先頭120文字。超えたら末尾に「…」）
--         - 消した状態で入ってきた行（deleted_at あり）には作らない
--         - お知らせづくりが失敗しても、コメントの保存は止めない（警告を出して、お知らせの分だけ取り消す）
--         - プッシュは、今ある notifications_push_dispatch が insert で送る（ここでは何もしない）
--   節 5: app_task_comment_retract_notice … task_comments の AFTER UPDATE OF deleted_at OR DELETE（行ごと）で動き、
--         消したコメントのお知らせを受信トレイから消す（「外部に公開」のまま書いてすぐ消した本文を、相手先の受信トレイに残さない）
--         - 動くとき: 論理削除（deleted_at が null → null 以外）・物理削除（タスクや案件ごとの連鎖削除を含む）。ほかの更新では何もしない
--         - 消す行: channel = 'in_app'・dedupe_key = 'task_comment:<コメントの id>'・type が comment_added / mention（既読も）。
--           ポータルの修正依頼で ball_passed に書き換えた行は残す
--         - 失敗しても、コメントの更新・削除は止めない（警告を出して、お知らせの分だけ取り消す）
--         - 送り終えたプッシュは取り消せない（揃えるのは受信トレイだけ）
--         - notifications_task_comment_dedupe_idx … dedupe_key で引くための部分索引（comment_added / mention の行だけ）
--   節 6: 末尾の確認（何も変えない）
--
-- 確認: 節 6 で、列・制約・トリガー・関数・索引の形と実行権が想定どおりかを確かめ、違えば止める
--       （同じ名前の別のトリガー・索引が既にあるときも止まる。トリガーと索引は無いときだけ作るため）。
-- 適用の順番: 本 migration を先に当てる。mention_user_ids を書く画面のコードが先に出ると、コメントの保存が
--       「列が無い」で失敗する。
-- 冪等: add column if not exists・create index if not exists・制約とトリガーは無いときだけ作る・create or replace function。
--       2回流しても同じ。
-- 検証: supabase/tests/run_task_comment_notify.sh（RED=1 で、本 migration が無いと失敗することも確かめる）
--
-- ロールバック（手で流す。上から順に。mention_user_ids を書く画面のコードを先に戻す）:
--   drop trigger if exists task_comments_retract_notice on public.task_comments;
--   drop function if exists public.app_task_comment_retract_notice();
--   drop index if exists public.notifications_task_comment_dedupe_idx;
--   drop trigger if exists task_comments_notify on public.task_comments;
--   drop function if exists public.app_task_comment_notify();
--   drop function if exists public.app_task_comment_visible_to_user(uuid, uuid, uuid, uuid, text);
--   alter table public.task_comments drop column if exists mention_user_ids;
-- ※ 列を消すと、コメントごとの名指しの記録は戻らない（元に戻せない）。制約は列と一緒に消える。
-- ※ 作ったお知らせは残る（dedupe_key が 'task_comment:' で始まる行）。受信トレイから消したいときだけ、別に消す。
-- ※ コメントを消したときに節 5 が消したお知らせは戻らない（元に戻せない）。戻したあとは、コメントを消してもお知らせが残る。
-- =============================================================================


-- =============================================================================
-- 節 1: ロック
--   DO 文の中で取る（空の DB から順に流す確認はトランザクションで包まないため。本番の適用は1トランザクションなので、
--   ロックは最後まで持つ）。取れなければ全体を取り消すので、流し直す。
--   notifications は節 5 の索引づくりに要る分（share: 読み取りは通し、書き込みを待たせる）。コメントを書くときの
--   順（task_comments → notifications）と同じ順で取る。
-- =============================================================================

do $$
begin
  set local lock_timeout = '3s';
  lock table public.task_comments in access exclusive mode;
  lock table public.notifications in share mode;
end $$;


-- =============================================================================
-- 節 2: 名指しした人の列（20人まで）
--   定数の既定値なので、表は書き直さない。今ある行は '{}' になる。
-- =============================================================================

alter table public.task_comments
  add column if not exists mention_user_ids uuid[] not null default '{}';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.task_comments'::regclass
       and conname = 'task_comments_mention_user_ids_check'
  ) then
    alter table public.task_comments
      add constraint task_comments_mention_user_ids_check check (cardinality(mention_user_ids) <= 20);
  end if;
end $$;

comment on column public.task_comments.mention_user_ids is
  '@で名指しした人（auth.users の id・20人まで）。保存したときのお知らせの宛先に使う（読めない人には届かない）';


-- =============================================================================
-- 節 3: その人がそのコメントを読めるか（task_comments_select を指定した人について判定する）
--   写した元（どれも auth.uid() で判定するので、p_user で書き直した）:
--     task_comments_select … 20260911143112_space_role_boundary.sql 節 4
--       app_is_space_internal(space_id, org_id)
--       or ( exists (tasks を RLS を通して読む) and ( (space の役割 = client and visibility = 'client')
--                                                    or (space の役割 = vendor and visibility = 'vendor') ) )
--     app_is_space_internal / app_space_role_of_caller … 20260911143112_space_role_boundary.sql 節 1
--     tasks_select_member = app_task_visible_to_caller(space_id, org_id, client_scope, ball)
--       … 20260703_010_rls_vendor_task_scope.sql（app_is_space_vendor もここ）
--     app_can_access_space / app_is_org_internal … 20260703_001_rls_helpers.sql
--   二要素認証の RESTRICTIVE ポリシー（mfa_required_when_enrolled）は見ない（ログイン中のセッションの状態で、
--   読める権利ではないため。コードを入力すれば読める人には届ける）。
--   task_comments / tasks の読み取りのポリシーを変えたら、この関数も同じに直す
--   （run_task_comment_notify.sh の chg_helper_matches_rls_* が食い違いを見つける）。
-- =============================================================================

create or replace function public.app_task_comment_visible_to_user(
  p_user uuid,
  p_space uuid,
  p_org uuid,
  p_task uuid,
  p_visibility text
)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(
    p_user is not null
    and (
      -- 社内（app_is_space_internal）: space がその組織のもので、組織の社内メンバーで、space の役割が client / vendor でない
      --   （space の役割が無ければ editor として扱う）。visibility を問わず読める
      (
        exists (select 1 from public.spaces s where s.id = p_space and s.org_id = p_org)
        and exists (select 1 from public.org_memberships om
                     where om.org_id = p_org and om.user_id = p_user and om.role in ('owner', 'admin', 'member'))
        and coalesce((select sm.role from public.space_memberships sm
                       where sm.space_id = p_space and sm.user_id = p_user), 'editor') not in ('client', 'vendor')
      )
      or (
        -- タスクが見える（app_task_visible_to_caller。タスク自身の space・組織で判定する）
        exists (
          select 1
            from public.tasks t
           where t.id = p_task
             -- app_can_access_space: space のメンバーか、組織の社内メンバー
             and (
               exists (select 1 from public.space_memberships sm where sm.space_id = t.space_id and sm.user_id = p_user)
               or exists (select 1 from public.org_memberships om
                           where om.org_id = t.org_id and om.user_id = p_user and om.role in ('owner', 'admin', 'member'))
             )
             and (
               -- 社内: 全件
               exists (select 1 from public.org_memberships om
                        where om.org_id = t.org_id and om.user_id = p_user and om.role in ('owner', 'admin', 'member'))
               -- 外部: 相手先に見せるタスク（deliverable）だけ。vendor はボールが相手先のものを除く
               or (
                 t.client_scope = 'deliverable'
                 and (
                   not exists (select 1 from public.space_memberships sv
                                where sv.space_id = t.space_id and sv.user_id = p_user and sv.role = 'vendor')
                   or t.ball is distinct from 'client'
                 )
               )
             )
        )
        -- space の役割と visibility（app_space_role_of_caller）: 相手先は 'client'・vendor は 'vendor' だけ
        and (
          (p_visibility = 'client'
           and (select sm.role from public.space_memberships sm
                 where sm.space_id = p_space and sm.user_id = p_user) = 'client')
          or (p_visibility = 'vendor'
           and (select sm.role from public.space_memberships sm
                 where sm.space_id = p_space and sm.user_id = p_user) = 'vendor')
        )
      )
    ),
    false
  );
$$;

comment on function public.app_task_comment_visible_to_user(uuid, uuid, uuid, uuid, text) is
  'お知らせの宛先の判定: p_user が、その space・組織・タスク・visibility のコメントを読めるか（task_comments_select を指定した人について判定。二要素認証は見ない）。service_role だけが実行できる';

-- 利用者が直接呼ぶと、ほかの人の所属を探れてしまうので、service_role だけにする（トリガー関数からは持ち主の権限で呼ぶ）
revoke all on function public.app_task_comment_visible_to_user(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.app_task_comment_visible_to_user(uuid, uuid, uuid, uuid, text) to service_role;


-- =============================================================================
-- 節 4: コメントが入ったらお知らせを作るトリガー
-- =============================================================================

create or replace function public.app_task_comment_notify()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_task_title text;
  v_assignee   uuid;
  v_from_name  text;
  v_message    text;
begin
  -- 消した状態で入ってきた行には作らない
  if new.deleted_at is not null then
    return null;
  end if;

  -- お知らせづくりの失敗で、コメントの保存を失敗させない（この中の変更だけを取り消して、警告を出す）
  begin
    select t.title, t.assignee_id
      into v_task_title, v_assignee
      from public.tasks t
     where t.id = new.task_id;

    if not found then
      return null;
    end if;

    select nullif(p.display_name, '')
      into v_from_name
      from public.profiles p
     where p.id = new.actor_id;

    v_message := case
                   when char_length(new.body) > 120 then left(new.body, 120) || '…'
                   else new.body
                 end;

    insert into public.notifications (org_id, space_id, to_user_id, channel, type, dedupe_key, payload)
    select new.org_id,
           new.space_id,
           r.user_id,
           'in_app',
           case when r.is_mention then 'mention' else 'comment_added' end,
           format('task_comment:%s', new.id),
           jsonb_build_object(
             'task_id', new.task_id,
             'task_title', v_task_title,
             'comment_id', new.id,
             'from_user_name', v_from_name,
             'title', case
                        when r.is_mention
                          then format('%sさんがコメントであなたを呼んでいます: 「%s」', coalesce(v_from_name, 'メンバー'), v_task_title)
                        else format('「%s」にコメントが付きました', v_task_title)
                      end,
             'message', v_message
           )
      from (
        select c.user_id, bool_or(c.is_mention) as is_mention
          from (
            -- 担当者
            select v_assignee as user_id, false as is_mention
            union all
            -- 社内承認の承認者（取り消した依頼は除く。承認・差し戻しをした人にも届ける）
            select ra.reviewer_id, false
              from public.review_approvals ra
              join public.reviews rv on rv.id = ra.review_id
             where rv.task_id = new.task_id
               and rv.status <> 'cancelled'
            union all
            -- これまでにコメントした人（消したコメントは数えない）
            select tc.actor_id, false
              from public.task_comments tc
             where tc.task_id = new.task_id
               and tc.deleted_at is null
               and tc.id <> new.id
            union all
            -- @で名指しされた人
            select m.user_id, true
              from unnest(new.mention_user_ids) as m(user_id)
          ) c
         where c.user_id is not null
           and c.user_id <> new.actor_id
         group by c.user_id
      ) r
     where public.app_task_comment_visible_to_user(r.user_id, new.space_id, new.org_id, new.task_id, new.visibility)
    on conflict (to_user_id, channel, dedupe_key) do nothing;
  exception when others then
    raise warning 'task comment notify: コメント % のお知らせを作れませんでした（%: %）', new.id, sqlstate, sqlerrm;
  end;

  return null;
end;
$$;

comment on function public.app_task_comment_notify() is
  'task_comments のトリガー: 担当者・承認者・これまでにコメントした人・名指しされた人のうち、書いた本人以外でコメントを読める人に、受信トレイのお知らせを作る（失敗してもコメントの保存は止めない）';

-- トリガーからだけ動かす（利用者が直接は呼べない。トリガーとしての実行には実行権は要らない）
revoke execute on function public.app_task_comment_notify() from public, anon, authenticated;

-- 無いときだけ作る（drop trigger は使わない。定義を変えるときは別の migration で作り直す）
do $$
begin
  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.task_comments'::regclass
       and tgname = 'task_comments_notify'
       and not tgisinternal
  ) then
    create trigger task_comments_notify
      after insert on public.task_comments
      for each row execute function public.app_task_comment_notify();
  end if;
end $$;


-- =============================================================================
-- 節 5: コメントを消したら、そのコメントのお知らせを受信トレイから消すトリガー
--   「外部に公開」のまま社内向けの内容を書いてすぐ消しても、社内の人や相手先の受信トレイに本文の先頭120文字が残らないようにする。
--   プッシュ（notifications_push_dispatch）は insert のときに送っているので取り消せない。受信トレイだけを揃える。
--   type で絞る: ポータルの修正依頼では、同じ dedupe_key の行を ball_passed に書き換える。その行は修正依頼の記録なので残す。
--   コメントの id は old.id を使う（id を書き換える更新でも、本人が持っていたコメントの分だけを消す）。
--   消したコメントを元に戻しても、お知らせは作り直さない。
-- =============================================================================

-- 消すときは dedupe_key で引く。一意キー（to_user_id, channel, dedupe_key）は to_user_id が先頭で使えないので、
-- コメントのお知らせだけの部分索引を足す（タスクや案件ごと消すと、消えるコメントの数だけ引くため）。
-- 20260715103920_digest_approval_notification.sql の notifications_digest_approval_dedupe_idx と同じ形。
create index if not exists notifications_task_comment_dedupe_idx
  on public.notifications (dedupe_key)
  where channel = 'in_app' and type in ('comment_added', 'mention');

create or replace function public.app_task_comment_retract_notice()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_key text;
begin
  -- 更新は、消したとき（deleted_at が null から null 以外になった）だけ。物理削除は、論理削除済みでも消す
  if tg_op = 'UPDATE' then
    if old.deleted_at is not null or new.deleted_at is null then
      return null;
    end if;
  end if;

  v_key := format('task_comment:%s', old.id);

  -- お知らせを消すのに失敗しても、コメントの更新・削除を失敗させない（この中の変更だけを取り消して、警告を出す）
  begin
    delete from public.notifications n
     where n.channel = 'in_app'
       and n.dedupe_key = v_key
       and n.type in ('comment_added', 'mention');
  exception when others then
    raise warning 'task comment retract: コメント % のお知らせを消せませんでした（%: %）', old.id, sqlstate, sqlerrm;
  end;

  return null;
end;
$$;

comment on function public.app_task_comment_retract_notice() is
  'task_comments のトリガー: コメントを消したら（論理削除・物理削除）、そのコメントの受信トレイのお知らせ（comment_added / mention）を既読も含めて消す。ball_passed に書き換えた行は残す（失敗してもコメントの削除は止めない）';

-- トリガーからだけ動かす（利用者が直接は呼べない。トリガーとしての実行には実行権は要らない）
revoke execute on function public.app_task_comment_retract_notice() from public, anon, authenticated;

-- 無いときだけ作る（drop trigger は使わない。定義を変えるときは別の migration で作り直す）。
-- 論理削除と物理削除を1本で受ける（update of deleted_at: 本文だけの更新では関数を呼ばない）
do $$
begin
  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.task_comments'::regclass
       and tgname = 'task_comments_retract_notice'
       and not tgisinternal
  ) then
    create trigger task_comments_retract_notice
      after update of deleted_at or delete on public.task_comments
      for each row execute function public.app_task_comment_retract_notice();
  end if;
end $$;


-- =============================================================================
-- 節 6: 末尾の確認（何も変えない）… 列・制約・トリガー・関数・索引の形と実行権。違えば止める
-- =============================================================================

do $$
declare
  v_bad  text := '';
  v_text text;
begin
  -- 列: uuid[]・not null・既定 '{}'
  select format('%s|%s|%s', format_type(a.atttypid, a.atttypmod), a.attnotnull::text, pg_get_expr(d.adbin, d.adrelid))
    into v_text
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.task_comments'::regclass
     and a.attname = 'mention_user_ids'
     and not a.attisdropped;
  if v_text is distinct from 'uuid[]|true|''{}''::uuid[]' then
    v_bad := v_bad || ' 列: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 制約: 20人まで（確かめ済み）
  select pg_get_constraintdef(c.oid) || '|' || c.convalidated::text
    into v_text
    from pg_constraint c
   where c.conrelid = 'public.task_comments'::regclass
     and c.conname = 'task_comments_mention_user_ids_check';
  if v_text is distinct from 'CHECK ((cardinality(mention_user_ids) <= 20))|true' then
    v_bad := v_bad || ' 制約: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- トリガー: 有効（O）・AFTER INSERT・行ごと（tgtype = 5）・条件なし・app_task_comment_notify() を呼ぶ
  select format('%s:%s:%s:%s', t.tgenabled::text, t.tgtype, (t.tgqual is null)::text,
                (t.tgfoid = to_regprocedure('public.app_task_comment_notify()'))::text)
    into v_text
    from pg_trigger t
   where t.tgrelid = 'public.task_comments'::regclass
     and t.tgname = 'task_comments_notify'
     and not t.tgisinternal;
  if v_text is distinct from 'O:5:true:true' then
    v_bad := v_bad || ' トリガー: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 消すトリガー: 有効（O）・AFTER UPDATE OF deleted_at OR DELETE・行ごと（tgtype = 25）・条件なし・
  --   app_task_comment_retract_notice() を呼ぶ
  select format('%s:%s:%s:%s:%s', t.tgenabled::text, t.tgtype, (t.tgqual is null)::text,
                (t.tgfoid = to_regprocedure('public.app_task_comment_retract_notice()'))::text,
                (select string_agg(a.attname, ',' order by a.attnum)
                   from pg_attribute a
                  where a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[])))
    into v_text
    from pg_trigger t
   where t.tgrelid = 'public.task_comments'::regclass
     and t.tgname = 'task_comments_retract_notice'
     and not t.tgisinternal;
  if v_text is distinct from 'O:25:true:true:deleted_at' then
    v_bad := v_bad || ' 消すトリガー: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 索引: dedupe_key・comment_added / mention のお知らせだけ
  v_text := pg_get_indexdef(to_regclass('public.notifications_task_comment_dedupe_idx'));
  if v_text is distinct from
     'CREATE INDEX notifications_task_comment_dedupe_idx ON public.notifications USING btree (dedupe_key) '
     'WHERE ((channel = ''in_app''::text) AND (type = ANY (ARRAY[''comment_added''::text, ''mention''::text])))' then
    v_bad := v_bad || ' 索引: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 関数: SECURITY DEFINER・search_path = public
  select string_agg(format('%s:%s:%s', p.proname, p.prosecdef::text, coalesce(array_to_string(p.proconfig, ';'), '')), ','
                    order by p.proname)
    into v_text
    from pg_proc p
   where p.oid in (to_regprocedure('public.app_task_comment_notify()'),
                   to_regprocedure('public.app_task_comment_retract_notice()'),
                   to_regprocedure('public.app_task_comment_visible_to_user(uuid,uuid,uuid,uuid,text)'));
  if v_text is distinct from
     'app_task_comment_notify:true:search_path=public,app_task_comment_retract_notice:true:search_path=public,'
     'app_task_comment_visible_to_user:true:search_path=public' then
    v_bad := v_bad || ' 関数: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 実行権: PUBLIC・anon・authenticated はどちらも実行できない。補助関数は service_role が実行できる
  select string_agg(r || ' → ' || f, ', ')
    into v_text
    from unnest(array['public', 'anon', 'authenticated']) as r,
         unnest(array['public.app_task_comment_notify()',
                      'public.app_task_comment_retract_notice()',
                      'public.app_task_comment_visible_to_user(uuid,uuid,uuid,uuid,text)']) as f
   where has_function_privilege(r, f, 'execute');
  if v_text is not null then
    v_bad := v_bad || ' 実行できてしまう: ' || v_text || ';';
  end if;
  if not has_function_privilege('service_role', 'public.app_task_comment_visible_to_user(uuid,uuid,uuid,uuid,text)', 'execute') then
    v_bad := v_bad || ' service_role が補助関数を実行できない;';
  end if;

  if v_bad <> '' then
    raise exception 'task comment notify: 想定と違います:%', v_bad;
  end if;
end $$;
