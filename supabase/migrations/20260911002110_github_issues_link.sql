-- =============================================================================
-- GitHub Issues 連携 PR1（DB 部分）: Issue の保存・タスクへの紐づけ・完了件数の集計
-- 確定設計: docs/spec/GITHUB_ISSUES_LINK_SPEC.md v1.2 §5・§6・§7.1・§7.2・§7.4・§9 PR1
--           （Fable 裁定 2026-09-10。1.2 の追加は 2026-09-11）
-- 依存: 20240205_000_github_integration.sql（github_repositories・update_github_updated_at）,
--       20260703_001_rls_helpers.sql（app_is_org_internal / app_is_space_member）,
--       20260907142526_mfa_rls_enforcement.sql（mfa_satisfied）を先に適用。
--
-- 目的: GitHub Issues を AgentPM のタスクに「ぶら下げる」ための器を作る（1件ずつ写すミラーではない）。
--   github_issues              GitHub の Issue の写し（webhook・照合 cron が service role で書く）
--   task_github_issue_links    タスクと Issue の紐づけ（1タスクに複数 Issue・1つの Issue を複数タスクにも可）
--   task_github_issue_rollups  タスクごとの open / 完了 / 見送り の件数（下の集計関数だけが書く）
--   github_recompute_issue_rollup(p_task_id)  上の件数を数え直す（service role だけが実行できる）
--   github_apply_issue_state(...)  Issue の upsert と、紐づく全タスクの数え直しを1つの取引で行う RPC
--                                  （webhook・照合 cron が使う。service role だけが実行できる）
--   紐づけの追加・削除では、task_github_issue_links のトリガー（文ごと）が数え直しの関数を呼ぶ。
--   tasks には列を足さず、行も書かない（仕様 §5・§6-3）。
--
-- 確定した可視性（社内 = app_is_org_internal(その行の org_id) = owner/admin/member。client・vendor は含まない）:
--   github_issues              select = 社内。書込ポリシーなし（service role のみ）
--   task_github_issue_links    select = 社内 かつ そのタスクの space のメンバー（app_is_space_member）
--                              insert = 社内 かつ space admin/editor かつ link_type = 'manual'
--                                       （§5 の書き手: 手動 = space admin/editor、auto/created = service role）
--                              delete = （作成者 or space admin）かつ 社内
--                              update = ポリシーなし
--   task_github_issue_rollups  select = 社内 かつ そのタスクの space のメンバー。書込ポリシーなし
--   3表とも、既存の全 RLS 表と同じ二要素認証の RESTRICTIVE ポリシー mfa_required_when_enrolled を付ける
--   （20260907142526 と同じ名前・同じ式。無ければ作る）。
--   ※ vendor は招待受諾で org role='client' になる（20260706004313）。社内判定は org role で行うため、
--     space role が editor/admin でも読めない・書けない（§4-12）。
--   ポリシーの書き方・名前は 20260910212804_rls_github_internal_only.sql（既存 GitHub 表）に揃える。
--
-- 組織一致トリガー（task_github_issue_links）: 行の org_id が、タスクの org_id と Issue の org_id の
--   両方と一致しなければ拒否する。タスクと Issue の参照は SECURITY DEFINER で行い、
--   呼び出した人の見える範囲に頼らない（§5 の注記。既存の check_task_pr_org_match とは作りを変えている）。
--
-- 集計（task_github_issue_rollups）の決まり:
--   open        = state が open
--   completed   = closed かつ state_reason が not_planned 以外（null・completed なども含む）
--   not_planned = closed かつ state_reason が not_planned（見送り）
--   all_closed_at = open が「1以上 → 0」に変わったら now()。open が 1 以上になったら null。それ以外は据え置き。
--   notified_at   = 列だけ用意する。通知の先着1回（条件付き UPDATE）は PR3 で作る。集計関数は触らない。
--   紐づきが0件になったら集計行を消す（理由は集計関数のコメント）。
--   いつ集計し直すか:
--     紐づけの追加・削除 → task_github_issue_links のトリガー（文ごと）が自動で呼ぶ（本人の権限の手動紐づけ・
--       service role の自動紐づけ・連鎖削除のすべて）。戻り値は使わない＝紐づけ・解除では通知しない。
--     Issue の状態の変化（webhook の opened/closed/reopened 等・照合 cron）→ 呼び出し側が github_apply_issue_state を
--       RPC で呼び、Issue の書き換えと数え直しを1つの取引で行う。通知は戻り値の became_all_closed で判定する。
--     複数タスクを数え直すときは、RPC もトリガーも task_id の順に集計行をロックする（デッドロックを避ける）。
--
-- 範囲: 新しい表3つ・関数4つ・ポリシー・トリガー・索引のみ。既存の表・列・ポリシー・関数・データは変更しない。
--   github_issue_create_intents（Issue 作成の二重防止）は PR2 で作る。
-- 冪等: create table / index if not exists、drop policy if exists → create policy、create or replace function、
--   drop trigger if exists → create trigger、二要素認証ポリシーは「無ければ作る」。再実行安全。
-- 破壊的変更: なし。可逆: 末尾のロールバック節（ただし表を消すと中身も消える。不可逆な点はそこに書く）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) github_issues: GitHub の Issue の写し（書くのは service role だけ）
-- -----------------------------------------------------------------------------
create table if not exists public.github_issues (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  github_repo_id    uuid not null references public.github_repositories(id) on delete cascade,
  issue_number      int not null,
  title             text not null,
  url               text not null,
  state             text not null check (state in ('open', 'closed')),
  state_reason      text null,
  author_login      text null,
  assignee_logins   text[] not null default '{}',
  issue_created_at  timestamptz null,
  closed_at         timestamptz null,
  github_updated_at timestamptz null,
  last_synced_at    timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (github_repo_id, issue_number)
);

create index if not exists github_issues_org_state_idx
  on public.github_issues (org_id, state);

comment on table public.github_issues is
  'GitHub Issue の写し（webhook・照合 cron が service role で upsert）。読めるのは社内メンバーだけ。tasks は書き換えない（GITHUB_ISSUES_LINK_SPEC §5・§6）';
comment on column public.github_issues.state_reason is
  'GitHub の state_reason をそのまま保存（completed / not_planned / reopened など）。集計では not_planned だけを見送りとして数える';

-- updated_at を更新のたびに進める（既存 GitHub 表と同じ関数）
drop trigger if exists github_issues_updated_at on public.github_issues;
create trigger github_issues_updated_at
  before update on public.github_issues
  for each row execute function public.update_github_updated_at();

-- -----------------------------------------------------------------------------
-- 2) task_github_issue_links: タスクと Issue の紐づけ
-- -----------------------------------------------------------------------------
create table if not exists public.task_github_issue_links (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  task_id         uuid not null references public.tasks(id) on delete cascade,
  github_issue_id uuid not null references public.github_issues(id) on delete cascade,
  link_type       text not null check (link_type in ('auto', 'manual', 'created')),
  -- 利用者を消しても紐づけは残す（作成者の記録だけ消える）。近年の表（email_templates 等）と同じ扱い
  created_by      uuid null references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (task_id, github_issue_id)
);

-- タスク側からの検索は上の一意制約の索引（task_id 始まり）で足りる。Issue 側から引くための索引
create index if not exists task_github_issue_links_issue_idx
  on public.task_github_issue_links (github_issue_id);

comment on table public.task_github_issue_links is
  'タスクと GitHub Issue の紐づけ（1:多・多:1 とも可）。auto=TP-番号 / manual=人が選んだ / created=AgentPM から作成';

-- 組織一致トリガー: 行の org_id・タスクの org_id・Issue の org_id が全て同じでなければ拒否
create or replace function public.check_task_issue_org_match()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_task_org  uuid;
  v_issue_org uuid;
begin
  -- SECURITY DEFINER: RLS を通らずに実際の org_id を読む（呼び出した人に見えるかどうかで結果を変えない）
  select t.org_id into v_task_org from public.tasks t where t.id = new.task_id;
  select i.org_id into v_issue_org from public.github_issues i where i.id = new.github_issue_id;

  -- 見つからない場合と組織が違う場合は同じ文言で返す（別組織の ID の有無を区別させない）
  if v_task_org is null
     or v_issue_org is null
     or new.org_id <> v_task_org
     or new.org_id <> v_issue_org then
    raise exception 'Link, task and issue must belong to the same organization';
  end if;

  return new;
end;
$$;

comment on function public.check_task_issue_org_match() is
  'task_github_issue_links の組織一致チェック（行・タスク・Issue の org_id が全て同じ）。SECURITY DEFINER で参照する';

-- トリガー専用。直接は実行させない（トリガーとしての実行には EXECUTE 権限は要らない）
revoke all on function public.check_task_issue_org_match() from public, anon, authenticated;

drop trigger if exists task_github_issue_links_org_check on public.task_github_issue_links;
create trigger task_github_issue_links_org_check
  before insert or update on public.task_github_issue_links
  for each row execute function public.check_task_issue_org_match();

-- -----------------------------------------------------------------------------
-- 3) task_github_issue_rollups: タスクごとの件数（書くのは下の集計関数だけ）
-- -----------------------------------------------------------------------------
create table if not exists public.task_github_issue_rollups (
  task_id           uuid primary key references public.tasks(id) on delete cascade,
  org_id            uuid not null references public.organizations(id) on delete cascade,
  open_count        int not null default 0,
  completed_count   int not null default 0,
  not_planned_count int not null default 0,
  all_closed_at     timestamptz null,
  notified_at       timestamptz null,
  updated_at        timestamptz not null default now()
);

comment on table public.task_github_issue_rollups is
  'タスクに紐づく Issue の件数。github_recompute_issue_rollup だけが書く（紐づけの追加・削除ではトリガーが呼ぶ。PR3 で notified_at の条件付き UPDATE が加わる）。紐づきが0件のタスクには行が無い';
comment on column public.task_github_issue_rollups.all_closed_at is
  'open が 1以上→0 になった時刻。open が 1 以上に戻ると null';
comment on column public.task_github_issue_rollups.notified_at is
  '「作業が全部終わりました」を通知した時刻（PR3 で使う。集計関数は触らない）';

-- -----------------------------------------------------------------------------
-- 4) RLS: 読み書きは社内メンバーに限定（service role は RLS を通らない）
-- -----------------------------------------------------------------------------
alter table public.github_issues enable row level security;
alter table public.task_github_issue_links enable row level security;
alter table public.task_github_issue_rollups enable row level security;

-- github_issues: select = 社内（書込ポリシーは作らない = service role のみ）
drop policy if exists "internal members can view issues" on public.github_issues;
create policy "internal members can view issues"
  on public.github_issues
  for select
  using ( public.app_is_org_internal(org_id) );

-- task_github_issue_links: select = 社内 かつ そのタスクの space のメンバー
drop policy if exists "internal space members can view task issue links" on public.task_github_issue_links;
create policy "internal space members can view task issue links"
  on public.task_github_issue_links
  for select
  using (
    public.app_is_org_internal(org_id)
    and exists (
      select 1 from public.tasks t
      where t.id = task_github_issue_links.task_id
        and public.app_is_space_member(t.space_id)
    )
  );

-- task_github_issue_links: insert = 社内 かつ space admin/editor かつ 手動の紐づけだけ
--   （auto / created は webhook・Issue 作成の service role が書く。§5 の書き手）
drop policy if exists "space editors can create task issue links" on public.task_github_issue_links;
create policy "space editors can create task issue links"
  on public.task_github_issue_links
  for insert
  with check (
    public.app_is_org_internal(org_id)
    and link_type = 'manual'
    and task_id in (
      select t.id from public.tasks t
      join public.space_memberships sm on sm.space_id = t.space_id
      where sm.user_id = auth.uid()
        and sm.role in ('admin', 'editor')
    )
  );

-- task_github_issue_links: delete = （作成者 or space admin）かつ 社内（update は作らない）
drop policy if exists "link creators or space admins can delete task issue links" on public.task_github_issue_links;
create policy "link creators or space admins can delete task issue links"
  on public.task_github_issue_links
  for delete
  using (
    public.app_is_org_internal(org_id)
    and (
      created_by = auth.uid()
      or task_id in (
        select t.id from public.tasks t
        join public.space_memberships sm on sm.space_id = t.space_id
        where sm.user_id = auth.uid()
          and sm.role = 'admin'
      )
    )
  );

-- task_github_issue_rollups: select = 社内 かつ そのタスクの space のメンバー（書込ポリシーは作らない）
drop policy if exists "internal space members can view issue rollups" on public.task_github_issue_rollups;
create policy "internal space members can view issue rollups"
  on public.task_github_issue_rollups
  for select
  using (
    public.app_is_org_internal(org_id)
    and exists (
      select 1 from public.tasks t
      where t.id = task_github_issue_rollups.task_id
        and public.app_is_space_member(t.space_id)
    )
  );

-- 二要素認証: 登録済みの利用者はコード入力済み(aal2)でなければ触れない（既存の全 RLS 表と同じ。無ければ作る）
do $$
declare
  v_table text;
begin
  foreach v_table in array array['github_issues', 'task_github_issue_links', 'task_github_issue_rollups'] loop
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

-- -----------------------------------------------------------------------------
-- 5) 集計関数: github_recompute_issue_rollup(p_task_id)
--
-- 戻り値（1行。タスクか組織が無ければ0行 = 何もしない）:
--   open_count_before        再計算前の open 件数（集計行が無ければ 0）
--   open_count_after         再計算後の open 件数
--   completed_count_after    再計算後の完了件数
--   not_planned_count_after  再計算後の見送り件数
--   all_closed_at_after      再計算後の all_closed_at（集計行を消したときは null）
--   became_all_closed        この呼び出しで open が「1以上→0」になり all_closed_at を入れたか
-- 通知してよいのは、Issue のクローズを受けた呼び出しの戻り値で became_all_closed が true のときだけ（§7.4）。
-- 紐づけ・解除のトリガー経由の再計算では通知しない。部分解除（閉じた Issue が残る形で open だけ外す）でも
-- all_closed_at は入るので、PR3 は notified_at の条件だけで通知を判定しないこと。
--
-- 仕様 §5 の旧版はこの関数を (p_task_id, p_notify bool) としていたが、通知は呼び出し側が戻り値で判定するので
-- 引数は p_task_id だけ（2026-09-11 に仕様も修正）。PR3 で引数や戻り値の列を変えるときは create or replace
-- では置き換わらない（引数が違うと別の関数が増え、戻り値の型は変えられない）ので、先に
-- drop function public.github_recompute_issue_rollup(uuid) すること（紐づけトリガーの関数は名前で呼ぶので作り直し不要）。
-- -----------------------------------------------------------------------------
create or replace function public.github_recompute_issue_rollup(p_task_id uuid)
  returns table (
    open_count_before       int,
    open_count_after        int,
    completed_count_after   int,
    not_planned_count_after int,
    all_closed_at_after     timestamptz,
    became_all_closed       boolean
  )
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_org         uuid;
  v_prev_open   int;
  v_prev_closed timestamptz;
  v_total       int;
  v_open        int;
  v_completed   int;
  v_not_planned int;
  v_all_closed  timestamptz;
begin
  -- タスクか組織が無ければ何もしない（0行を返す）。
  --   タスクの削除・組織の削除などの連鎖削除の途中で、紐づけ解除のトリガーから呼ばれた場合も含む。
  --   組織が先に消えていると集計行の外部キーに反するので、連鎖の順番（制約の作成順で決まり、
  --   復元などで変わりうる）に頼らずここで止める。集計行はタスク・組織の cascade で消える。
  select t.org_id into v_org
    from public.tasks t
    join public.organizations o on o.id = t.org_id
   where t.id = p_task_id;
  if not found then
    return;
  end if;

  -- (1) 集計行を作る/ロックしてから「変更前の open」を読む。
  --     同じタスクの再計算が同時に走っても、後から来た方はこのロックが外れるまで待ち、
  --     前の結果を「変更前」として読む → 「1以上→0」は1回だけ報告される。
  --     行が無ければ open=0 の行を作る（=「変更前は 0」。紐づきが0件なら (3) で消す）。
  insert into public.task_github_issue_rollups as r (task_id, org_id)
  values (p_task_id, v_org)
  on conflict (task_id) do update set org_id = excluded.org_id
  returning r.open_count, r.all_closed_at into v_prev_open, v_prev_closed;

  -- (2) ロックを取ったあとで数える（並行した再計算・紐づけの変更も反映した最新の状態）
  select count(*)::int,
         (count(*) filter (where i.state = 'open'))::int,
         (count(*) filter (where i.state = 'closed' and i.state_reason is distinct from 'not_planned'))::int,
         (count(*) filter (where i.state = 'closed' and i.state_reason = 'not_planned'))::int
    into v_total, v_open, v_completed, v_not_planned
    from public.task_github_issue_links l
    join public.github_issues i on i.id = l.github_issue_id
   where l.task_id = p_task_id;

  if v_total = 0 then
    -- (3) 紐づきが0件 → 集計行を消す（0 のまま残さない）。理由:
    --   ・「全部閉じた」は紐づいた Issue が1件以上あるときだけ意味を持つ。0件の行に all_closed_at が
    --     残ると、PR3 の先着1回の条件（all_closed_at があり、notified_at が無いかそれより古い）を満たした
    --     ままになり、「解除・削除では通知しない」（§7.4）が後の処理のしかた次第で破れうる。
    --     行を消せばその状態が残らない。
    --   ・行が無い状態から再び紐づけると「変更前の open = 0」から数え直すので、既に閉じた Issue を
    --     後から紐づけても「1以上→0」にならず、all_closed_at も入らない（§7.4「後付けでは通知しない」）。
    --   ・画面側も「行が無い = 紐づいた Issue が無い」と読める。
    --   消えるのは通知済みの記録（notified_at）も含むが、次に通知できるのは新たに紐づけた open が
    --   閉じて「1以上→0」になったときだけなので、同じ完了を二重に知らせることはない。
    delete from public.task_github_issue_rollups r where r.task_id = p_task_id;
    v_all_closed := null;
  else
    v_all_closed := case
      when v_open > 0 then null          -- 再オープン等で open が戻った → null（もう一度全部閉じたら再通知できる）
      when v_prev_open >= 1 then now()   -- open が 1以上 → 0 になった
      else v_prev_closed                 -- 0 → 0（閉じた Issue の後付け・変化なし）は据え置き
    end;
    update public.task_github_issue_rollups r
       set open_count        = v_open,
           completed_count   = v_completed,
           not_planned_count = v_not_planned,
           all_closed_at     = v_all_closed,
           updated_at        = now()
     where r.task_id = p_task_id;
  end if;

  return query
    select v_prev_open, v_open, v_completed, v_not_planned, v_all_closed,
           (v_prev_open >= 1 and v_open = 0 and v_total > 0);
end;
$$;

comment on function public.github_recompute_issue_rollup(uuid) is
  'タスクに紐づく Issue の open/完了/見送りを数え直して task_github_issue_rollups に保存する（紐づき0件なら行を消す）。変更前後の open と、1以上→0 になったかを返す。通知はしない。service role 専用（紐づけの追加・削除ではトリガーが呼ぶ）';

-- 実行は service role だけ。所有者（紐づけトリガーの関数の実行者）の権限は revoke しても残る
revoke all on function public.github_recompute_issue_rollup(uuid) from public, anon, authenticated;
grant execute on function public.github_recompute_issue_rollup(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 6) Issue の書き換えと再計算を1回で行う RPC: github_apply_issue_state(...)
--   webhook（issues の opened/edited/closed/reopened/assigned/unassigned）と照合 cron が service role で呼ぶ。
--   Issue の upsert と、その Issue に紐づく全タスクの再計算を1つの DB 取引で行う。
--   → 「閉じた」は確定するまで他の再計算から見えないので、紐づけ・解除のトリガーによる再計算が同時に走っても
--     そちらが「1以上→0」を先に報告することはなく、報告はこの RPC の1回だけになる（通知の取りこぼし・二重を防ぐ）。
--   戻り値: 紐づくタスクごとに1行（task_id の順）。列は task_id ＋ github_recompute_issue_rollup と同じ6列。
--     紐づくタスクが無ければ0行（Issue の行は書く）。通知の判定は呼び出し側（became_all_closed かつ原因が closed）。
--   ロックの順番（デッドロックを避ける）:
--     (a) 先に Issue の行を for update で取る。紐づけの追加は外部キーの確認でこの行に共有ロックを取るので、
--         同じ Issue への紐づけの追加と重なったら先に始めた方の確定を待つ。紐づけが先ならその紐づけも数えに入り、
--         こちらが先なら紐づけ側が「閉じた」を見てから集計する（どちらでも数がずれない）。
--     (b) 集計行は task_id の順に取る（github_recompute_issue_rollup の中で取る）。紐づけのトリガーも同じ順番。
--   組織一致: 引数の org_id が github_repo_id のリポジトリの組織と違えば拒否する（呼び出し側の値を信じない）。
--   古い通知: 引数の github_updated_at が保存済みより厳密に古ければ、書き換えず・数え直さない（詳細は関数内）。
-- -----------------------------------------------------------------------------
create or replace function public.github_apply_issue_state(
  p_org_id            uuid,
  p_github_repo_id    uuid,
  p_issue_number      int,
  p_title             text,
  p_url               text,
  p_state             text,
  p_state_reason      text,
  p_author_login      text,
  p_assignee_logins   text[],
  p_issue_created_at  timestamptz,
  p_closed_at         timestamptz,
  p_github_updated_at timestamptz
)
  returns table (
    task_id                 uuid,
    open_count_before       int,
    open_count_after        int,
    completed_count_after   int,
    not_planned_count_after int,
    all_closed_at_after     timestamptz,
    became_all_closed       boolean
  )
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_repo_org       uuid;
  v_issue_id       uuid;
  v_stored_updated timestamptz;
  v_task           uuid;
begin
  select r.org_id into v_repo_org from public.github_repositories r where r.id = p_github_repo_id;
  if v_repo_org is null or v_repo_org is distinct from p_org_id then
    raise exception 'Issue and repository must belong to the same organization';
  end if;

  -- (a) Issue の行を先に取る（まだ無ければ取るものは無い。無い Issue には紐づけも無い）
  select gi.id, gi.github_updated_at into v_issue_id, v_stored_updated
    from public.github_issues gi
   where gi.github_repo_id = p_github_repo_id and gi.issue_number = p_issue_number
   for update;

  -- 古い通知で巻き戻さない: webhook は届く順番が入れ替わることがある。
  --   引数の github_updated_at が保存済みより厳密に古ければ、Issue の行を書き換えず、数え直しもしない。
  --   両方に時刻があるときだけ比べる。同じ時刻なら書き換える（同じ時刻に複数の action が来るため）。
  --   どちらかが null なら今までどおり書き換える。
  --   戻り値は紐づくタスクごとに「変化なし」（変更前 = 変更後 = 保存済みの件数・became_all_closed = false）。
  --   比べるのは上で行を取ったあとなので、同じ Issue の RPC が重なっても、後の方は先の方が確定した時刻と比べる。
  if v_issue_id is not null
     and v_stored_updated is not null
     and p_github_updated_at is not null
     and p_github_updated_at < v_stored_updated then
    return query
      select t.task_id, coalesce(r.open_count, 0), coalesce(r.open_count, 0),
             coalesce(r.completed_count, 0), coalesce(r.not_planned_count, 0), r.all_closed_at, false
        from (select distinct l.task_id
                from public.task_github_issue_links l
               where l.github_issue_id = v_issue_id) t
        left join public.task_github_issue_rollups r on r.task_id = t.task_id
       order by t.task_id;
    return;
  end if;

  insert into public.github_issues as gi (
    org_id, github_repo_id, issue_number, title, url, state, state_reason, author_login,
    assignee_logins, issue_created_at, closed_at, github_updated_at, last_synced_at
  ) values (
    p_org_id, p_github_repo_id, p_issue_number, p_title, p_url, p_state, p_state_reason, p_author_login,
    coalesce(p_assignee_logins, '{}'), p_issue_created_at, p_closed_at, p_github_updated_at, now()
  )
  on conflict (github_repo_id, issue_number) do update
    set org_id            = excluded.org_id,
        title             = excluded.title,
        url               = excluded.url,
        state             = excluded.state,
        state_reason      = excluded.state_reason,
        author_login      = excluded.author_login,
        assignee_logins   = excluded.assignee_logins,
        issue_created_at  = excluded.issue_created_at,
        closed_at         = excluded.closed_at,
        github_updated_at = excluded.github_updated_at,
        last_synced_at    = excluded.last_synced_at
  returning gi.id into v_issue_id;

  -- (b) 紐づく全タスクを、同じ取引の中で task_id の順に集計し直す
  for v_task in
    select distinct l.task_id
      from public.task_github_issue_links l
     where l.github_issue_id = v_issue_id
     order by l.task_id
  loop
    return query
      select v_task, r.open_count_before, r.open_count_after, r.completed_count_after,
             r.not_planned_count_after, r.all_closed_at_after, r.became_all_closed
        from public.github_recompute_issue_rollup(v_task) r;
  end loop;
end;
$$;

comment on function public.github_apply_issue_state(uuid, uuid, int, text, text, text, text, text, text[], timestamptz, timestamptz, timestamptz) is
  'Issue の写しを upsert し、紐づく全タスクの件数を同じ取引で task_id の順に数え直す。紐づくタスクごとに変更前後の open と became_all_closed を返す。通知はしない。service role 専用';

revoke all on function public.github_apply_issue_state(uuid, uuid, int, text, text, text, text, text, text[], timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.github_apply_issue_state(uuid, uuid, int, text, text, text, text, text, text[], timestamptz, timestamptz, timestamptz)
  to service_role;

-- -----------------------------------------------------------------------------
-- 7) 紐づけの追加・削除で集計し直すトリガー（文ごと）
--   画面から本人の権限で手動の紐づけ・解除をしても、サーバーの API を通さずに集計が正しくなる
--   （本人は集計関数を実行できないので、SECURITY DEFINER のトリガー関数から呼ぶ）。
--   service role の自動紐づけ（auto / created）、タスク・Issue の削除による連鎖削除でも同じく効く。
--   1つの文で追加・削除された紐づけ（遷移テーブル changed_links）のタスクを task_id の順に集計し直す
--   （github_apply_issue_state と同じ順番・同じロック。行ごとだと行の並び順でロックしてしまう）。
--   戻り値は使わない＝紐づけ・解除では通知しない（§7.4）。Issue の状態の変化はここでは拾わない。
--   update では動かない（紐づけの update ポリシーは無く、service role も task_id / github_issue_id を書き換えない前提）。
--   遷移テーブルは複数の操作を1本のトリガーに持てないので、追加用と削除用の2本にする（関数は共通）。
-- -----------------------------------------------------------------------------
create or replace function public.github_issue_link_recompute_rollup()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_task uuid;
begin
  for v_task in
    select distinct c.task_id from changed_links c order by c.task_id
  loop
    perform * from public.github_recompute_issue_rollup(v_task);
  end loop;
  return null;  -- AFTER トリガーなので戻り値は使われない
end;
$$;

comment on function public.github_issue_link_recompute_rollup() is
  'task_github_issue_links の追加・削除（文ごと）で、変わったタスクを task_id の順に github_recompute_issue_rollup で数え直すトリガー関数（戻り値は使わない＝通知しない）';

-- トリガー専用。直接は実行させない
revoke all on function public.github_issue_link_recompute_rollup() from public, anon, authenticated;

-- この migration の以前の版（未リリース）で作った行ごとのトリガーが残っていれば外す
drop trigger if exists task_github_issue_links_recompute_rollup on public.task_github_issue_links;

drop trigger if exists task_github_issue_links_recompute_rollup_ins on public.task_github_issue_links;
create trigger task_github_issue_links_recompute_rollup_ins
  after insert on public.task_github_issue_links
  referencing new table as changed_links
  for each statement execute function public.github_issue_link_recompute_rollup();

drop trigger if exists task_github_issue_links_recompute_rollup_del on public.task_github_issue_links;
create trigger task_github_issue_links_recompute_rollup_del
  after delete on public.task_github_issue_links
  referencing old table as changed_links
  for each statement execute function public.github_issue_link_recompute_rollup();

-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_github_issues_link.sh（全 PASS）
--      RED=1 を付けると本 migration 抜きで流し、assert が落ちることを確認できる。
--   1) 適用後に本番でポリシーを確認:
--        select tablename, policyname, permissive, cmd from pg_policies
--         where schemaname = 'public'
--           and tablename in ('github_issues', 'task_github_issue_links', 'task_github_issue_rollups')
--         order by tablename, policyname;
--      → permissive は5本（issues: SELECT / links: SELECT・INSERT・DELETE / rollups: SELECT）
--        ＋ 3表とも mfa_required_when_enrolled（RESTRICTIVE）。
--      select public.mfa_enforcement_status() -> 'policy_missing'; に3表が出ないこと。
--   2) select has_function_privilege('authenticated', 'public.github_recompute_issue_rollup(uuid)', 'execute');
--      → false（service_role だけが true）。
--   3) select tgname from pg_trigger where tgrelid = 'public.task_github_issue_links'::regclass and not tgisinternal;
--      → task_github_issue_links_org_check と task_github_issue_links_recompute_rollup_ins / _del の3つ
--        （行ごとの task_github_issue_links_recompute_rollup が無いこと）。
--      select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p where p.proname = 'github_apply_issue_state';
--      → false（service_role だけが true）。
--   4) 既存の GitHub 連携（PR の紐づけ・設定画面）が従来どおり動くこと（既存の表・ポリシーは変更していない）。
--
-- ロールバック（手動・必要時のみ。PR1 の DB 部分を丸ごと戻す）。
-- ※ 不可逆: 表を消すと中身も消える。github_issues は GitHub から取り直せる（webhook の再受信か照合が要る）が、手動の紐づけ（link_type='manual'）と通知済みの記録（notified_at）は戻せない。
-- ※ 先に、この表を読み書きするアプリ側（webhook の issues 処理・Inspector の Issue 一覧・紐づけ操作）を止めること。
-- ※ 表を消すとポリシー・トリガー・索引も一緒に消える（表の削除では紐づけトリガーは動かない）。update_github_updated_at は既存の関数なので消さない。
--   drop table if exists public.task_github_issue_rollups;
--   drop table if exists public.task_github_issue_links;
--   drop table if exists public.github_issues;
--   drop function if exists public.github_issue_link_recompute_rollup();
--   drop function if exists public.github_apply_issue_state(uuid, uuid, int, text, text, text, text, text, text[], timestamptz, timestamptz, timestamptz);
--   drop function if exists public.github_recompute_issue_rollup(uuid);
--   drop function if exists public.check_task_issue_org_match();
-- =============================================================================
