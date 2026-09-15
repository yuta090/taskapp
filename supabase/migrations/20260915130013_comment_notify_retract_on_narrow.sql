-- =============================================================================
-- コメントの公開範囲や、タスクの見せ方（相手先に見せるか）を狭めたら、そのコメントのお知らせを
-- 読めなくなった人の受信トレイから消す
--
-- 問題（2026-09-15）:
--   20260915105122_task_comment_notify.sql は、コメントを書いた時点で読める人にだけお知らせ（comment_added / mention）を作る。
--   読めるかの判定はその1回だけなので、あとからコメントを「社内のみ」に変えたり、タスクを相手先に見せないようにしたり、
--   ボールを相手先に渡したり（vendor はボールが相手先のタスクを読めない）しても、相手先・vendor の受信トレイに
--   タスク名とコメントの先頭120文字が残る。コメント自体は RLS で読めなくなるのに、お知らせからは読めてしまう。
--   20260915105122 はまだ本番に出していないので、同じ昇格で塞ぐ。
--
-- 対応:
--   節 1: 前提の確認とロック（tasks → task_comments の順に share row exclusive で押さえる。読み取りは止めず、書き込みを待たせる。
--         待つのは 3 秒まで。access exclusive には上げない）
--   節 2: app_task_comment_retract_on_visibility_change … task_comments の AFTER UPDATE OF visibility（行ごと・
--         visibility が変わったときだけ）で動く。そのコメントのお知らせを、宛先ごとに新しい visibility で判定し直す
--   節 3: app_task_comment_retract_on_task_scope_change … tasks の AFTER UPDATE OF client_scope（行ごと・
--         client_scope が変わったときだけ）で動く。そのタスクのコメント（消したものも含む）のお知らせを、宛先ごとに
--         そのコメントの visibility で判定し直す（判定はそのときのボールも見る）
--         - ボールの受け渡し（ball だけの変化）では消さない（ユーザー判断: 消すと、ボールが相手先にある間に vendor が
--           名指しに気づけなくなるため）。残るのは vendor あてに書かれ、書いた時点で本人が読めた抜粋。コメント自体は、
--           ボールが相手先にある間は RLS で読めず、ボールが戻れば読める
--         - コメントの無いタスクは、コメントの索引（idx_task_comments_task_id）を1回引くだけで終わる
--           （失敗を握る区画 begin … exception に入る前に判定するので、サブトランザクションも作らない）
--   2つに共通:
--         - 消す行: channel = 'in_app'・dedupe_key = 'task_comment:<コメントの id>'・type が comment_added / mention（既読も）の
--           うち、宛先の人が app_task_comment_visible_to_user で読めないと判定された行だけ。読める人の行は残す
--         - 広げる向き（社内のみ → 相手先向け・社内のみ → 相手先に見える）の変化では何も消えない。消した行の作り直しもしない
--         - メールの行（channel = 'email'）・ポータルの修正依頼で ball_passed に書き換えた行は残す
--         - 判定を使って消すのに失敗したら、判定を使わずに消す（後備え）: そのコメント（タスク側はそのタスクのコメント）の
--           in_app・comment_added / mention の行を、宛先を問わず全部消す。社内の人の行も消えるが、コメント本体は残るので害は小さい。
--           作る側（20260915105122）は失敗を握っても「届かない」で済むが、消す側で握ると「読めてはいけない抜粋が残る」側に倒れる。
--           補助関数は language sql で、本文が読む列への依存を DB が記録しない。space_memberships.role などを変える migration が
--           補助関数を直し忘れると、呼ぶたびに失敗して、狭めても1行も消えないまま気づけない。後備えはそれを防ぐ
--         - 後備えで消せたときも、消した件数と判定の失敗の理由を警告に1行出す（判定の仕組みが壊れて、社内の人の通知まで
--           消え続けても気づけるように）。後備えも失敗したら、両方の理由を警告に出す。どちらでも元の更新（コメント・タスク）は
--           止めない（後備えも失敗したときは、お知らせの分だけ取り消す）
--         - 送り終えたプッシュ（notifications_push_dispatch が insert のときに送る）は取り消せない。揃えるのは受信トレイだけ
--         - 消すときは 20260915105122 の部分索引（notifications_task_comment_dedupe_idx）で引く。索引は足さない
--   節 4: 末尾の確認（何も変えない）
--
-- 範囲外: space のメンバーから外した・space や組織の役割を変えたときの判定し直し（ほかのお知らせの種類と共通の話なので、別に扱う）。
--   タスクの見せ方を狭める更新と、同じタスクへのコメントの書き込みがほぼ同時に走ったとき（書き込み側は狭める前の見せ方で判定し、
--   狭める側はまだ確定していないそのコメントを見ない）の行も、ここでは消さない。
--
-- 確認: 節 4 で、トリガー・関数の形と実行権、前提（20260915105122 の補助関数・索引）が想定どおりかを確かめ、違えば止める
--       （同じ名前の別のトリガーが既にあるときも止まる。トリガーは無いときだけ作るため）。
-- 適用の順番: 20260915105122_task_comment_notify.sql のあと（前提が無ければ節 1 で止まる）。画面のコードは変えないので、
--       コードとの順番は問わない。
-- ロック: tasks は常に読み書きされる表。drop trigger は使わない（トリガーがあれば if exists を付けても access exclusive を取るので、
--       drop → create で付け直す形は2回目の適用で access exclusive に上がる。本番で deadlock した前例がある）。
--       create trigger が要る share row exclusive を先頭で取る。
-- 冪等: create or replace function・トリガーは無いときだけ作る。2回流しても同じ。
-- 検証: supabase/tests/run_comment_notify_retract_on_narrow.sh（RED=1 で、本 migration が無いと失敗することも確かめる。
--       適用中に tasks・task_comments へ access exclusive を取らないこと・取る順番・大量のデータでの実行計画も見る。
--       下の「緊急に止める」「ロールバック」の手順も、書いてあるとおりに流して確かめる）
--
-- 緊急に止める（手で流す。上から順に。表のロックを取らないので、混んでいる時間でもすぐ流せる）:
--   create or replace function public.app_task_comment_retract_on_visibility_change()
--     returns trigger language plpgsql security definer set search_path = public
--   as $$ begin return null; end; $$;
--   create or replace function public.app_task_comment_retract_on_task_scope_change()
--     returns trigger language plpgsql security definer set search_path = public
--   as $$ begin return null; end; $$;
-- ※ 2つの関数の本体を「何もしない」に差し替えるだけ。tasks・task_comments の読み書きは止めない（トリガー・実行権はそのまま残る）。
-- ※ 止めている間は、見せ方を狭めてもお知らせが残る（20260915105122 だけの状態と同じ）。本 migration を流し直すと再開する。
-- ※ 止めている間に残った行は、再開しても自動では消えない。次にそのコメントの公開範囲か、タスクの見せ方が変わったときに消える。
-- ※ トリガーと関数そのものを消すのは、下の「ロールバック」を空いている時間に流す。
--
-- ロールバック（手で流す。1トランザクションで上から順に。まず止めるだけなら、上の「緊急に止める」を先に流す）:
-- ※ 両方の表に access exclusive を取る。ロックを待つ間（最大 3 秒）も、あとから来た読み取りが並んで待つので、全画面の読み込みが止まる。
-- ※ 空いている時間に流す。取る順番は本 migration と同じ tasks → task_comments。
--   set local lock_timeout = '3s';
--   lock table public.tasks, public.task_comments in access exclusive mode;
--   drop trigger if exists tasks_retract_comment_notice_on_scope_change on public.tasks;
--   drop function if exists public.app_task_comment_retract_on_task_scope_change();
--   drop trigger if exists task_comments_retract_on_visibility_change on public.task_comments;
--   drop function if exists public.app_task_comment_retract_on_visibility_change();
-- ※ 本 migration が消したお知らせは戻らない（元に戻せない）。戻したあとは、見せ方を狭めてもお知らせが残る（20260915105122 だけの状態）。
-- ※ 列・表・索引は変えていないので、戻しても行の中身は変わらない。
-- =============================================================================


-- =============================================================================
-- 節 1: ロックと前提の確認
--   ロックは DO 文の中で取る（空の DB から順に流す確認はトランザクションで包まないため。本番の適用は1トランザクションなので、
--   ロックは最後まで持つ）。取れなければ全体を取り消すので、流し直す。
--   share row exclusive は create trigger が取るのと同じ強さ（読み取りは通し、書き込みを待たせる）。途中で強いロックに上げない。
--   tasks → task_comments の順で取る。両方の表に書く1つのトランザクションは、タスクを消す → コメントが外部キーの連鎖で消える
--   （tasks → task_comments）の順なので、同じ順にして、互いに相手の表を待ち合う deadlock を避ける
--   （コメントを書くときは tasks を読むだけで、読み取りのロックは share row exclusive とぶつからない）。
--   前提: 20260915105122 の補助関数と索引。無いとトリガーは作れても、毎回判定に失敗して後備えで宛先を問わず消し続けるので、ここで止める。
-- =============================================================================

do $$
begin
  set local lock_timeout = '3s';
  lock table public.tasks, public.task_comments in share row exclusive mode;
end $$;

do $$
begin
  if to_regprocedure('public.app_task_comment_visible_to_user(uuid,uuid,uuid,uuid,text)') is null
     or to_regclass('public.notifications_task_comment_dedupe_idx') is null then
    raise exception 'comment notify retract on narrow: 前提が無い（20260915105122_task_comment_notify.sql を先に当てる）';
  end if;
end $$;


-- =============================================================================
-- 節 2: コメントの visibility が変わったら、読めなくなった人のお知らせを消すトリガー
--   お知らせは書いたときのコメントの id で作ってあるので、id は old.id を使う（20260915105122 の節 5 と同じ）。
--   判定は更新後の行（new）の space・組織・タスク・visibility で行う。
-- =============================================================================

create or replace function public.app_task_comment_retract_on_visibility_change()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_state text;
  v_msg   text;
  v_count bigint;
begin
  -- 判定を使って、読めなくなった人の行だけを消す
  begin
    delete from public.notifications n
     where n.channel = 'in_app'
       and n.dedupe_key = format('task_comment:%s', old.id)
       and n.type in ('comment_added', 'mention')
       and not public.app_task_comment_visible_to_user(n.to_user_id, new.space_id, new.org_id, new.task_id, new.visibility);
  exception when others then
    -- 失敗したら（補助関数が壊れているなど）、判定を使わずに、そのコメントのお知らせを宛先を問わず消す（後備え）。
    -- 読めてはいけない抜粋を残さない側に倒す。社内の人の行も消えるが、コメント本体は残る
    v_state := sqlstate;
    v_msg   := sqlerrm;
    begin
      delete from public.notifications n
       where n.channel = 'in_app'
         and n.dedupe_key = format('task_comment:%s', old.id)
         and n.type in ('comment_added', 'mention');
      -- 消せたときも1行知らせる（判定の仕組みが壊れて、社内の人の通知まで消え続けても気づけるように）
      get diagnostics v_count = row_count;
      raise warning 'task comment visibility retract: コメント % のお知らせ % 件を、判定を使わずに宛先を問わず消しました（判定: %: %）',
        old.id, v_count, v_state, v_msg;
    exception when others then
      -- それも失敗したら、コメントの更新は止めずに警告だけ出す（この中の変更だけを取り消す）
      raise warning 'task comment visibility retract: コメント % のお知らせを消せませんでした（判定: %: % / 判定を使わずに消す: %: %）',
        old.id, v_state, v_msg, sqlstate, sqlerrm;
    end;
  end;

  return null;
end;
$$;

comment on function public.app_task_comment_retract_on_visibility_change() is
  'task_comments のトリガー: visibility が変わったら、そのコメントの受信トレイのお知らせ（comment_added / mention）のうち、宛先の人が新しい visibility で読めない行を消す（判定に失敗したら宛先を問わず消して警告を出す。それも失敗してもコメントの更新は止めない）';

-- トリガーからだけ動かす（利用者が直接は呼べない。トリガーとしての実行には実行権は要らない）
revoke execute on function public.app_task_comment_retract_on_visibility_change() from public, anon, authenticated;

-- 無いときだけ作る（drop trigger は使わない。定義を変えるときは別の migration で作り直す）。
-- update of visibility と when: 本文だけの更新や、同じ値を書く更新では関数を呼ばない
do $$
begin
  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.task_comments'::regclass
       and tgname = 'task_comments_retract_on_visibility_change'
       and not tgisinternal
  ) then
    create trigger task_comments_retract_on_visibility_change
      after update of visibility on public.task_comments
      for each row
      when (old.visibility is distinct from new.visibility)
      execute function public.app_task_comment_retract_on_visibility_change();
  end if;
end $$;


-- =============================================================================
-- 節 3: タスクの見せ方（client_scope）が変わったら、そのタスクのコメントの、読めなくなった人のお知らせを消すトリガー
--   補助関数はタスクの今の client_scope / ball を読む（AFTER トリガーなので、この更新のあとの値が見える）。
--   ボールの受け渡し（ball だけの変化）では動かない（ユーザー判断。ヘッダーの節 3 の説明）。
--   消したコメントも数える（消したときに 20260915105122 の節 5 がお知らせを消しているので、ふつうは何も当たらない）。
-- =============================================================================

create or replace function public.app_task_comment_retract_on_task_scope_change()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_state text;
  v_msg   text;
  v_count bigint;
begin
  -- コメントの無いタスクは、ここで終わる。コメントの索引を1回引くだけにし、
  -- 失敗を握る区画（入るたびにサブトランザクションを作る）より前で判定する（この1回の問い合わせは失敗を握らない）
  if not exists (select 1 from public.task_comments c where c.task_id = new.id) then
    return null;
  end if;

  -- 判定を使って、読めなくなった人の行だけを消す
  begin
    delete from public.notifications n
     using public.task_comments c
     where c.task_id = new.id
       and n.channel = 'in_app'
       and n.dedupe_key = 'task_comment:' || c.id::text
       and n.type in ('comment_added', 'mention')
       and not public.app_task_comment_visible_to_user(n.to_user_id, c.space_id, c.org_id, c.task_id, c.visibility);
  exception when others then
    -- 失敗したら（補助関数が壊れているなど）、判定を使わずに、そのタスクのコメントのお知らせを宛先を問わず消す（後備え）。
    -- 読めてはいけない抜粋を残さない側に倒す。社内の人の行も消えるが、コメント本体は残る
    v_state := sqlstate;
    v_msg   := sqlerrm;
    begin
      delete from public.notifications n
       using public.task_comments c
       where c.task_id = new.id
         and n.channel = 'in_app'
         and n.dedupe_key = 'task_comment:' || c.id::text
         and n.type in ('comment_added', 'mention');
      -- 消せたときも1行知らせる（判定の仕組みが壊れて、社内の人の通知まで消え続けても気づけるように）
      get diagnostics v_count = row_count;
      raise warning 'task scope comment retract: タスク % のコメントのお知らせ % 件を、判定を使わずに宛先を問わず消しました（判定: %: %）',
        new.id, v_count, v_state, v_msg;
    exception when others then
      -- それも失敗したら、タスクの更新は止めずに警告だけ出す（この中の変更だけを取り消す）
      raise warning 'task scope comment retract: タスク % のコメントのお知らせを消せませんでした（判定: %: % / 判定を使わずに消す: %: %）',
        new.id, v_state, v_msg, sqlstate, sqlerrm;
    end;
  end;

  return null;
end;
$$;

comment on function public.app_task_comment_retract_on_task_scope_change() is
  'tasks のトリガー: client_scope が変わったら（ボールの受け渡しでは動かない）、そのタスクのコメントの受信トレイのお知らせ（comment_added / mention）のうち、宛先の人がそのコメントを読めない行を消す（判定に失敗したら宛先を問わず消して警告を出す。それも失敗してもタスクの更新は止めない）';

-- トリガーからだけ動かす（利用者が直接は呼べない。トリガーとしての実行には実行権は要らない）
revoke execute on function public.app_task_comment_retract_on_task_scope_change() from public, anon, authenticated;

-- 無いときだけ作る（drop trigger は使わない。定義を変えるときは別の migration で作り直す）。
-- update of client_scope と when: ボール・タイトル・状態などの更新や、同じ値を書く更新では関数を呼ばない（ボールでは消さない）
do $$
begin
  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.tasks'::regclass
       and tgname = 'tasks_retract_comment_notice_on_scope_change'
       and not tgisinternal
  ) then
    create trigger tasks_retract_comment_notice_on_scope_change
      after update of client_scope on public.tasks
      for each row
      when (old.client_scope is distinct from new.client_scope)
      execute function public.app_task_comment_retract_on_task_scope_change();
  end if;
end $$;


-- =============================================================================
-- 節 4: 末尾の確認（何も変えない）… トリガー・関数の形と実行権、前提。違えば止める
-- =============================================================================

do $$
declare
  v_bad  text := '';
  v_text text;
begin
  -- コメントのトリガー: 有効（O）・app_task_comment_retract_on_visibility_change() を呼ぶ・
  --   AFTER UPDATE OF visibility・行ごと・visibility が変わったときだけ
  select string_agg(format('%s:%s:%s', t.tgenabled::text,
                           (t.tgfoid = to_regprocedure('public.app_task_comment_retract_on_visibility_change()'))::text,
                           regexp_replace(pg_get_triggerdef(t.oid), ' EXECUTE FUNCTION .*$', '')), ';')
    into v_text
    from pg_trigger t
   where t.tgrelid = 'public.task_comments'::regclass
     and t.tgname = 'task_comments_retract_on_visibility_change'
     and not t.tgisinternal;
  if v_text is distinct from
     'O:true:CREATE TRIGGER task_comments_retract_on_visibility_change AFTER UPDATE OF visibility ON public.task_comments '
     'FOR EACH ROW WHEN ((old.visibility IS DISTINCT FROM new.visibility))' then
    v_bad := v_bad || ' コメントのトリガー: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- タスクのトリガー: 有効（O）・app_task_comment_retract_on_task_scope_change() を呼ぶ・
  --   AFTER UPDATE OF client_scope・行ごと・client_scope が変わったときだけ（ball は含めない）
  select string_agg(format('%s:%s:%s', t.tgenabled::text,
                           (t.tgfoid = to_regprocedure('public.app_task_comment_retract_on_task_scope_change()'))::text,
                           regexp_replace(pg_get_triggerdef(t.oid), ' EXECUTE FUNCTION .*$', '')), ';')
    into v_text
    from pg_trigger t
   where t.tgrelid = 'public.tasks'::regclass
     and t.tgname = 'tasks_retract_comment_notice_on_scope_change'
     and not t.tgisinternal;
  if v_text is distinct from
     'O:true:CREATE TRIGGER tasks_retract_comment_notice_on_scope_change AFTER UPDATE OF client_scope ON public.tasks '
     'FOR EACH ROW WHEN ((old.client_scope IS DISTINCT FROM new.client_scope))' then
    v_bad := v_bad || ' タスクのトリガー: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 関数: SECURITY DEFINER・search_path = public
  select string_agg(format('%s:%s:%s', p.proname, p.prosecdef::text, coalesce(array_to_string(p.proconfig, ';'), '')), ','
                    order by p.proname)
    into v_text
    from pg_proc p
   where p.oid in (to_regprocedure('public.app_task_comment_retract_on_visibility_change()'),
                   to_regprocedure('public.app_task_comment_retract_on_task_scope_change()'));
  if v_text is distinct from
     'app_task_comment_retract_on_task_scope_change:true:search_path=public,'
     'app_task_comment_retract_on_visibility_change:true:search_path=public' then
    v_bad := v_bad || ' 関数: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 実行権: PUBLIC・anon・authenticated はどれも実行できない
  select string_agg(r || ' → ' || f, ', ')
    into v_text
    from unnest(array['public', 'anon', 'authenticated']) as r,
         unnest(array['public.app_task_comment_retract_on_visibility_change()',
                      'public.app_task_comment_retract_on_task_scope_change()']) as f
   where has_function_privilege(r, f, 'execute');
  if v_text is not null then
    v_bad := v_bad || ' 実行できてしまう: ' || v_text || ';';
  end if;

  -- 前提: 判定に使う補助関数と、消すときに引く索引
  if to_regprocedure('public.app_task_comment_visible_to_user(uuid,uuid,uuid,uuid,text)') is null
     or to_regclass('public.notifications_task_comment_dedupe_idx') is null then
    v_bad := v_bad || ' 前提（補助関数・索引）が無い;';
  end if;

  if v_bad <> '' then
    raise exception 'comment notify retract on narrow: 想定と違います:%', v_bad;
  end if;
end $$;
