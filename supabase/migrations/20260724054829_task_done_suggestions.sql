-- =============================================================================
-- 完了サジェスト台帳（task_done_suggestions） — Fable裁定
--
-- 目的:
--   LINE上の完了宣言テキストを検知し「『X』を完了にしますか？」とDMで確認を出す機能の
--   **重複防止台帳**。不変条件は「1タスク＝生涯1サジェスト」（何度も聞かない・却下後も出さない）。
--
-- 冪等の要（重要）:
--   task_id に **通常の unique** を張る（1タスク=生涯1行）。送信は
--     insert ... on conflict (task_id) do nothing
--   の「送信勝者のみ push」運用で、webhook再配送・複数worker競合での二重DMを防ぐ。
--   却下(dismissed)後は行が残る＝task_id unique が再サジェストを恒久的に抑止する
--   （行を消さない限り再送されない）。partial unique は不要。
--
-- 設計判断:
--   - この台帳に org_id 列は持たない。テナント境界は task_id → tasks.org_id で一意に解決できる
--     （tasks.org_id は not null）。列を複製すると tasks の実所属と食い違う余地を作るため持たない。
--   - suggested_to_user_id は **auth.users(id)** を参照する。DM宛先＝宣言した本人は
--     channel_user_links.user_id（→ auth.users）で解決される内部ユーザーであり、
--     tasks.assignee_id / created_by・channel_user_links.user_id と同じ user 参照作法に合わせる
--     （profiles は表示名の投影に過ぎず、行の存在を前提にできないため参照先にしない）。
--   - channel_group_id / trigger_message_id は **監査用**。テナント境界は担わない（task_idが担う）。
--     監査ポインタなので削除時は行を消さず NULL 化する（on delete set null）。
--     trigger_message_id の channel_messages(id) 参照は既存作法あり
--     （channel_digest_tasks.source_message_id, 20260711073329:153）に倣い FK を張る。
--
-- RLS:
--   - 書込: **service role のみ**（webhook/cron の admin client が insert/update）。
--     anon/authenticated には書込ポリシーを作らない＋ REVOKE で明示的に閉じる。
--   - 読取: 既存 channel 系（channel_messages）と同じく **内部メンバーのみ**。
--     この台帳に org_id が無いため task→org を join し app_is_org_internal で判定する。
--     顧問先(client/vendor)には見せない（完了検知は内部向けの証跡）。UIが直接読む予定は
--     当面無いが、将来のインスペクタ/監査表示に備え内部読取のみ開けておく（越境はしない）。
--
-- ロールバック（不可逆点の明示）:
--   drop table public.task_done_suggestions cascade;
--   ※ tasks からの on delete cascade により、タスク削除でこの台帳行も消える（意図どおり）。
--     行が消えると「そのタスクに既にサジェスト済み」という抑止事実も失われる点に注意
--     （タスク自体が消える文脈なので実害なし）。台帳そのものの drop は監査履歴の喪失＝不可逆。
-- =============================================================================

create table if not exists public.task_done_suggestions (
  id uuid primary key default gen_random_uuid(),
  -- 対象タスク。タスク削除で台帳行も消す（親子の生存を一致させる）
  task_id uuid not null references public.tasks(id) on delete cascade,
  -- 発生元グループ（監査用・任意）。テナント境界は担わない
  channel_group_id uuid null references public.channel_groups(id) on delete set null,
  -- きっかけの channel_messages.id（監査用・任意）。append-only背骨への監査ポインタ
  trigger_message_id uuid null references public.channel_messages(id) on delete set null,
  -- DM宛先＝完了を宣言した本人（内部ユーザー）。channel_user_links.user_id と同軸
  suggested_to_user_id uuid null references auth.users(id) on delete set null,
  status text not null default 'sent'
    check (status in ('sent', 'confirmed', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ★冪等の要: 1タスク=生涯1行。on conflict (task_id) do nothing の競合キーになり、
-- 再サジェスト（却下後含む）を恒久抑止する。task_id 検索のインデックスも兼ねる。
create unique index if not exists task_done_suggestions_task_unique
  on public.task_done_suggestions(task_id);

comment on table public.task_done_suggestions is
  '完了サジェストの重複防止台帳。1タスク=生涯1行（task_id unique）。insert は on conflict (task_id) do nothing で送信勝者のみDM。dismissed行も残し再サジェストを恒久抑止。書込=service roleのみ・読取=内部メンバーのみ';
comment on column public.task_done_suggestions.channel_group_id is '発生元グループ（監査用）。テナント境界は task_id→tasks.org_id が担う';
comment on column public.task_done_suggestions.trigger_message_id is 'きっかけの channel_messages.id（監査用）';
comment on column public.task_done_suggestions.suggested_to_user_id is 'DM宛先＝完了を宣言した本人（auth.users）';
comment on column public.task_done_suggestions.status is 'sent(送信済)→confirmed(承認で完了化)/dismissed(却下)。どの終端でも行は残り再サジェストしない';

-- -----------------------------------------------------------------------------
-- RLS: 書込=service roleのみ / 読取=内部メンバーのみ（task→org join）
-- -----------------------------------------------------------------------------
alter table public.task_done_suggestions enable row level security;

-- 書込ポリシーは作らない = anon/authenticated から insert/update/delete 不可（service_role のみ）
revoke all on table public.task_done_suggestions from anon, authenticated;
grant select on table public.task_done_suggestions to authenticated;

drop policy if exists task_done_suggestions_select_internal on public.task_done_suggestions;
create policy task_done_suggestions_select_internal
  on public.task_done_suggestions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tasks t
      where t.id = task_done_suggestions.task_id
        and public.app_is_org_internal(t.org_id)
    )
  );

-- =============================================================================
-- 検証（適用後に実施）:
--   1) 冪等: 同一 task_id への2回目 insert ... on conflict (task_id) do nothing が 0行。
--   2) 却下抑止: status='dismissed' に更新後も行が残り、再 insert が 0行（task_id unique）。
--   3) 破壊的変更なし: 新規テーブルのみ。既存テーブル/ポリシーの変更なし。
--   4) 越境なし: 他orgのタスクに紐づく行が、その org の内部メンバーでない authenticated から 0行。
--   5) 書込閉塞: authenticated からの insert/update が RLS/権限で拒否される。
-- =============================================================================
