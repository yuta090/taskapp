-- =============================================================================
-- AI秘書 Stage 5 期限リマインド — PR-0（正本境界＋スキーマ基盤）
--
-- 設計: docs/spec/AI_SECRETARY_STAGE5_DUE_REMINDERS.md（DRAFT v2・Fable再裁定3クラックス）
-- 本migrationの範囲（DDL/RPC/トリガーのみ。TS/UI/cron/planner/sender は別担当・後続PR）:
--   1) tasks.due_authority_connection_id（正本権威列）＋ backfill ＋ 読取専用ガードトリガー（§4.1/§5）
--   2) task_due_reminder_occurrences（リマインド occurrence）＋ claim/finalize RPC（§4.2/§6）
--   3) integration_connections.last_import_success_at（鮮度列・§4.3/§6）
--   4) _enqueue_connector_job（connector_jobs への enqueue ヘルパ・§4.4／PR-0前倒し）
--
-- 正本ルール（§2・ハード制約）: external ツールに紐づくタスク（connector_task_links.origin='external'）は
--   常にその外部ツールが期限の正本。TaskApp は読み取ってリマインドを乗せるだけで期限を書き戻さない。
--   → external権威タスクの due_date は TaskApp（authenticated）からは編集不可（DB層トリガーで強制）。
--
-- 適用: アプリ稼働中に本番共用DBへ適用可（新規オブジェクト＋列追加のみ・既存行を壊さない）。
--   backfill は due_date を触らないためガードトリガー作成前に実行し、既存行に副作用を与えない。
--
-- 依存: 20260720125427_connector_two_way_sync.sql（connector_task_links / connector_jobs /
--   connector_jobs_pending_unique）と integration_connections・tasks が先行適用済みであること。
--
-- ロールバック: 本migrationが導入する列/表/関数/トリガーはすべて DROP 可逆。
--   ただし §2.1 の製品契約「external権威タスクの期限は TaskApp で編集不可」は緩める向きにしか
--   動かせない（締める＝炎上・緩める＝無風）。トリガーを単純撤去すると誤リマインド事故の穴が開く。
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) 正本権威列 ＋ backfill ＋ 読取専用ガードトリガー（§4.1 / §5）
-- -----------------------------------------------------------------------------

-- NULL = TaskApp が期限正本（TaskApp発タスク）。値 = そのタスク行を作成した import 接続に固定。
-- 自動再割当てはしない（1タスクに external link が複数あり得るが、due を書く実体は出自接続だけ・§5.3）。
-- ON DELETE SET NULL: 接続削除でこの列が NULL 化＝TaskApp正本へ縮退し、期限編集が復帰する。
alter table public.tasks
  add column if not exists due_authority_connection_id uuid
    references public.integration_connections(id) on delete set null;
comment on column public.tasks.due_authority_connection_id is
  'このタスクの期限(due_date)の正本。NULL=TaskApp正本(編集可)／値=その期限を管理する外部import接続(編集不可・自動再割当てしない・接続削除でON DELETE SET NULLによりNULLへ縮退)。強制は trg_guard_external_due。';

-- backfill: 既存の external 紐付けタスクへ権威を後埋めする。1タスクに external link が複数ある場合は
-- created_at 最古の link の connection_id（＝出自接続）を採用する（§5.3・タイブレークは connection_id）。
-- ⚠ provider ゲート必須: 権威は「実際に due を取り込むコネクタ（dueImport）」の接続だけに限定する。
--   現状 dueImport は google_tasks のみ（multica は due_date を持たない・§3）。ゲートが無いと
--   multica 起点タスク（rpc_connector_create_task が origin='external' link を作るが due 無し）にも
--   権威が付き、TaskApp で期限を後付けできなくなる（読取専用トリガーで拒否される）。
--   gtasks import→multica 転送タスク（gtasks+multica の2 external link）は、このゲートで multica 側が
--   除外され、自然に google_tasks 接続が権威に決まる。将来 dueImport コネクタを足す時はこの集合を広げる。
-- ガードトリガー作成前に実行するため due_date を触らない本UPDATEはトリガーを発火させない。
update public.tasks t
set due_authority_connection_id = src.connection_id
from (
  select distinct on (l.task_id) l.task_id, l.connection_id
  from public.connector_task_links l
  join public.integration_connections c on c.id = l.connection_id
  where l.origin = 'external'
    and c.provider = 'google_tasks'   -- dueImport コネクタに限定（現状 gtasks のみ）
  order by l.task_id, l.created_at asc, l.connection_id asc
) src
where src.task_id = t.id
  and t.due_authority_connection_id is null;

-- 読取専用ガード: external権威タスクの due_date 変更を authenticated から拒否する。
--   auth.role()='service_role'（import worker／connector RPC の admin client）だけ通す＝fail-closed。
--   ブラウザ(authenticated)の supabase.from('tasks').update(...) はここで RAISE され、
--   useTasks.ts の throw→楽観更新ロールバック経路に乗る（サイレント巻き戻しは乖離するので不採用）。
-- security definer は不要（テーブルアクセスせず auth.role() を読むだけ）。search_path は明示固定する。
create or replace function public.app_guard_external_due()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  -- メッセージに 'due_managed_externally' を必ず含める（UI/テストの識別キー）。errcode はカスタム。
  raise exception 'due_managed_externally: この期限は外部ツールが正本のため TaskApp からは編集できません'
    using errcode = 'DUEXT';
end;
$$;
comment on function public.app_guard_external_due() is
  'external権威タスク(due_authority_connection_id 非NULL)の due_date 変更を service_role 以外から拒否する BEFORE UPDATE ガード。トリガー trg_guard_external_due 専用。';

-- ⚠ WHEN 節は必須（省略禁止）: このトリガーは全 tasks UPDATE の hot-path に載る。WHEN で
--   「due_date が実際に変わる」かつ「external権威である」行だけに発火を絞り、それ以外の更新
--   （title 変更・status 変更・TaskApp発タスクの due 編集）には判定コストを一切載せない。
-- ⚠ service_role 素通しの棚卸し（2026-07-21実施）: service key 経由で tasks.due_date を UPDATE する
--   経路は gtasks import worker（src/lib/google-tasks/import.ts:196-203・正規）のみ。INSERT(同:110-116)は
--   BEFORE UPDATE の対象外。dispatch.ts / notify-approval / multica client は due_date を読み取り外向き
--   payload に載せるだけで tasks を書かない。client(useTasks.ts)は authenticated のため本ガードで塞がる。
--   将来 due_date を書く authenticated 向け RPC を足すと本トリガーに当たる（意図的・§5.4）。
drop trigger if exists trg_guard_external_due on public.tasks;
create trigger trg_guard_external_due
  before update on public.tasks
  for each row
  when (old.due_date is distinct from new.due_date and old.due_authority_connection_id is not null)
  execute function public.app_guard_external_due();


-- -----------------------------------------------------------------------------
-- 2) リマインド occurrence ＋ claim/finalize RPC（§4.2 / §6）
--    planner(cron) が due_date × 設定から occurrence を materialize し、sender(cron) が
--    claim→鮮度3条件→送信→finalize する。planner/sender 実装は後続PR。ここは表とRPCのみ。
-- -----------------------------------------------------------------------------
create table if not exists public.task_due_reminder_occurrences (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references public.tasks(id) on delete cascade,
  -- kind: テンプレラベル（本文の出し分け用）。offset_minutes と独立。
  kind           text not null check (kind in ('due_soon', 'due_today', 'overdue_confirm')),
  -- offset_minutes: 負=期限前・0=当日・正=超過。occurrence identity の一部（複数オフセット共存）。
  offset_minutes int  not null,
  -- due_snapshot: この occurrence を生成した時点の due_date。送信直前に task の現 due と照合し、
  --   動いていたら送らず suppressed 終端にする（§6 鮮度条件2）。
  due_snapshot   date not null,
  scheduled_at   timestamptz not null,
  status         text not null default 'pending'
                 check (status in ('pending', 'leased', 'sent', 'suppressed', 'canceled')),
  leased_until   timestamptz,
  attempt        int  not null default 0,   -- claim ごとに +1（再claim/予算差戻しの打ち止め用）
  send_count     int  not null default 0,   -- スヌーズ通番。決定的 retryKey の一部（LINE側dedupe）。
  sent_at        timestamptz,
  suppress_reason text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- 複数オフセット（1日前＋当日＋超過）を「1タスク×1期限」で共存させる occurrence key。
  -- due が動けば新 snapshot で新 occurrence が生まれ、旧 snapshot 分は §6 で suppressed 終端。
  unique (task_id, due_snapshot, offset_minutes)
);
comment on table public.task_due_reminder_occurrences is
  '期限リマインドの occurrence（planner が materialize・sender が claim/送信/finalize）。unique(task_id,due_snapshot,offset_minutes) で複数オフセットを1タスク1期限に共存。service role専用(RLS有効・policyなし)。';

-- sender が拾う実用index: 期限到来した pending を scheduled_at 昇順で。lease 失効の再claim対象も含める。
create index if not exists task_due_reminder_occurrences_claim_idx
  on public.task_due_reminder_occurrences (scheduled_at)
  where status in ('pending', 'leased');
create index if not exists task_due_reminder_occurrences_task_idx
  on public.task_due_reminder_occurrences (task_id);

-- occurrence は service role(planner/sender)専用。authenticated からは触らせない(RLS有効・policyなし)。
alter table public.task_due_reminder_occurrences enable row level security;

-- claim RPC: 到来 pending＋lease 失効 leased を for update skip locked で最大 p_limit 件 lease する。
--   rpc_claim_connector_jobs / rpc_claim_task_mirror_jobs と同作法（10分lease）。二重取得は skip locked で防ぐ。
create or replace function public.rpc_claim_due_reminder_occurrences(
  p_limit int default 100,
  p_now   timestamptz default now()
)
returns setof public.task_due_reminder_occurrences
language plpgsql
security definer
set search_path = public
as $$
declare
  -- lease は cron 間隔×2 を目安に 10 分。push成功→finalize前クラッシュ時に lease 失効で再claim させる。
  v_lease_until timestamptz := p_now + interval '10 minutes';
begin
  return query
  with candidates as (
    select o.id
    from public.task_due_reminder_occurrences o
    where (
        (o.status = 'pending' and o.scheduled_at <= p_now)
        or (o.status = 'leased' and o.leased_until is not null and o.leased_until <= p_now)  -- lease失効の回収
      )
    order by o.scheduled_at asc
    limit greatest(p_limit, 1)
    for update of o skip locked
  )
  update public.task_due_reminder_occurrences o
  set status       = 'leased',
      leased_until = v_lease_until,
      attempt      = o.attempt + 1,
      updated_at   = now()
  from candidates
  where o.id = candidates.id
  returning o.*;
end;
$$;

-- finalize RPC: 送信結果を確定する。
--   p_outcome:
--     'sent'      → status='sent'（送信完了・終端）
--     'suppressed'→ status='suppressed'＋suppress_reason（鮮度/done等の恒久抑止・終端・§6）
--     'deferred'  → 予算/縮退による一時抑止。pending に戻し scheduled_at を翌窓へ（永久ロストさせない・
--                   approval-notify の教訓）。attempt 上限で canceled 打ち止め。
--   終端(sent/suppressed/canceled)は不変＝二重finalizeを握る。
create or replace function public.rpc_finalize_due_reminder_occurrence(
  p_id      uuid,
  p_outcome text,
  p_reason  text default null
)
returns public.task_due_reminder_occurrences
language plpgsql
security definer
set search_path = public
as $$
declare
  -- TODO(spec §13 open item・数値のみ実装時確定): 予算抑止差戻しの再送窓と attempt 上限は暫定値。
  --   安全側（送りすぎない・ロストさせない）に倒した仮値。planner/sender 実装時に登録値で定数化する。
  v_defer_interval constant interval := interval '1 hour';
  v_max_attempts   constant int      := 10;
  v_row public.task_due_reminder_occurrences%rowtype;
begin
  select * into v_row from public.task_due_reminder_occurrences where id = p_id for update;
  if not found then
    return null;
  end if;
  if v_row.status in ('sent', 'suppressed', 'canceled') then
    return v_row;  -- 終端は不変（二重finalizeを握る）
  end if;

  if p_outcome = 'sent' then
    update public.task_due_reminder_occurrences
      set status = 'sent', sent_at = now(), leased_until = null, suppress_reason = null, updated_at = now()
      where id = p_id returning * into v_row;

  elsif p_outcome = 'suppressed' then
    update public.task_due_reminder_occurrences
      set status = 'suppressed', suppress_reason = p_reason, leased_until = null, updated_at = now()
      where id = p_id returning * into v_row;

  elsif p_outcome = 'deferred' then
    if v_row.attempt >= v_max_attempts then
      update public.task_due_reminder_occurrences
        set status = 'canceled', suppress_reason = coalesce(p_reason, 'defer_attempts_exhausted'),
            leased_until = null, updated_at = now()
        where id = p_id returning * into v_row;
    else
      update public.task_due_reminder_occurrences
        set status = 'pending', scheduled_at = now() + v_defer_interval,
            leased_until = null, suppress_reason = p_reason, updated_at = now()
        where id = p_id returning * into v_row;
    end if;

  else
    raise exception 'invalid outcome: %', p_outcome using errcode = '22023';
  end if;

  return v_row;
end;
$$;


-- -----------------------------------------------------------------------------
-- 3) 鮮度列（§4.3 / §6）
-- -----------------------------------------------------------------------------
alter table public.integration_connections
  add column if not exists last_import_success_at timestamptz;
comment on column public.integration_connections.last_import_success_at is
  '鮮度証明: この接続の import が全ページ取得成功後にのみ前進させる（部分失敗ではカーソルも本列も進めない）。'
  'この不変条件が「時刻Tまでの全変更が反映済み」を接続単位で保証し、送信直前の鮮度ガード(§6 条件3・'
  'last_import_success_at >= now() - pollFreshnessSlaMinutes)の生命線になる。前進させる実体は import worker(別担当)。';


-- -----------------------------------------------------------------------------
-- 4) connector_jobs への enqueue ヘルパ（§4.4・PR-0前倒し）
--    _enqueue_task_mirror_job の connector_jobs 版クローン。(connection,task) の pending を最新1件に fold。
--    これを使う rpc_confirm_task_done_via_line は PR-2。ヘルパのみ本PRで用意する。内部専用（grantしない）。
-- -----------------------------------------------------------------------------
create or replace function public._enqueue_connector_job(
  p_connection uuid, p_task uuid, p_op text, p_payload jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.connector_jobs (connection_id, task_id, op, payload, status, next_attempt_at)
  values (p_connection, p_task, p_op, p_payload, 'pending', now())
  on conflict (connection_id, task_id) where status = 'pending'
  -- fold: op/payload を最新に上書きし attempt/next_attempt_at をリセット。version は必ず +1
  --   （処理中の worker に「あなたが取ったものは古い」と伝える鍵）。leased_until は触らない
  --   （実行中リースは claim/complete が管理する。ここでリセットすると二重 claim を招く）。
  do update set op = excluded.op, payload = excluded.payload,
                attempt = 0, next_attempt_at = now(), last_error = null,
                version = public.connector_jobs.version + 1, updated_at = now();
$$;
comment on function public._enqueue_connector_job(uuid, uuid, text, jsonb) is
  'connector_jobs へ送信ジョブを enqueue（(connection_id,task_id) の pending を最新1件に fold・version+1）。_enqueue_task_mirror_job の connector_jobs 版。内部専用（service_role のみ）。';


-- -----------------------------------------------------------------------------
-- 5) 権限: 新規関数は service role 専用にする（§5/§7・既存 connector/gtasks migration と同作法）。
--    Postgres は新規関数の EXECUTE を既定で PUBLIC に付与するため、明示 revoke しないと
--    anon/authenticated が SECURITY DEFINER の RPC を直接叩けてしまう。
--    トリガー関数(app_guard_external_due)はトリガー発火で動くため grant 不要（revoke のみ・
--    トリガー発火時に EXECUTE 権限は判定されないので revoke してもガードは機能する）。
-- -----------------------------------------------------------------------------
revoke all on function public.app_guard_external_due() from public, anon, authenticated;
revoke all on function public.rpc_claim_due_reminder_occurrences(int, timestamptz) from public, anon, authenticated;
revoke all on function public.rpc_finalize_due_reminder_occurrence(uuid, text, text) from public, anon, authenticated;
revoke all on function public._enqueue_connector_job(uuid, uuid, text, jsonb) from public, anon, authenticated;

grant execute on function public.rpc_claim_due_reminder_occurrences(int, timestamptz) to service_role;
grant execute on function public.rpc_finalize_due_reminder_occurrence(uuid, text, text) to service_role;
grant execute on function public._enqueue_connector_job(uuid, uuid, text, jsonb) to service_role;
