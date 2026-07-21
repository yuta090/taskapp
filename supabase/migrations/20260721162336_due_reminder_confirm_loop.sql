-- =============================================================================
-- AI秘書 Stage 5 期限リマインド — PR-2（完了確認ループの RPC）
--
-- 設計: docs/spec/AI_SECRETARY_STAGE5_DUE_REMINDERS.md §7（クラックスB・Fable再裁定）
-- 本migrationの範囲（RPC 2本のみ。TS/Flex/postback パーサ・設定UI は別担当・別PR）:
--   1) rpc_confirm_task_done_via_line  — LINE 完了確認 [完了した] の受け口
--      口座束縛 authz ＋ 完了ゲート ＋ single-winner 遷移 ＋ トランザクション内 connector
--      complete enqueue ＋ 監査 を 1 トランザクションに内包する。
--   2) rpc_snooze_due_reminder_via_line — LINE [まだ]/[○日後に再通知] の受け口
--      occurrence を pending へ差し戻し scheduled_at を前進、上限で canceled 終端。
--
-- ⚠ セキュリティ重大箇所（決済/認証/承認に準じる）: 完了は外部タスクツールへ terminal
--   complete を伝搬する不可逆な副作用を持つ。authz は rpc_promote_digest_task_via_line と同型で
--   厳格化する（口座×外部ユーザー→内部ユーザーを channel_user_links から解決・revoked 除外・
--   タスク org と link org 一致・在籍再検証・space アクセス確認）。client 供給の actor は受けない。
--
-- 依存（先行適用済みであること）:
--   20260721133427_due_reminder_pr0.sql（_enqueue_connector_job / task_due_reminder_occurrences）
--   20260720125427_connector_two_way_sync.sql（connector_task_links.state / connector_jobs）
--   20260715070647_channel_user_links.sql（channel_user_links）
--   20240101_000_schema.sql（tasks / org_memberships / space_memberships / reviews / task_events）
--   20260223_000_completed_at_tracking.sql（trg_task_completed_at＝status→done で completed_at 自動）
--
-- ロールバック / 不可逆性:
--   本migrationが導入するのは関数2本のみ＝DROP で完全に可逆（data migration なし・既存行不変）。
--   ただし runtime の副作用（外部ツールへ complete を送る）は取り消せない。関数を落としても
--   既に enqueue 済みの connector_jobs は残る（それは仕様どおり）。破壊的変更なし。
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0) タスク可視性ヘルパ（actor 版・セキュリティレビュー #1 HIGH 対応）
--    既存 app_task_visible_to_caller（20260703_010_rls_vendor_task_scope.sql）は auth.uid() 基準の
--    ため service_role 実行（auth.uid()=NULL）では使えない。そこで同関数の可視性マトリクスを、
--    LINE から解決した明示ユーザー p_actor について展開する。これが無いと、LINE連携済みの
--    client/vendor（または内部→client 降格で link 残存）が、本来見えないタスク UUID を差し替えて
--    完了/スヌーズできてしまう（org 在籍・space アクセスだけでは client_scope/ball/vendor scope を
--    見ないため素通しする）。org 一致解決の後、対象タスクが p_actor に可視でなければ拒否する。
--    マトリクス（app_task_visible_to_caller と一致）:
--      内部(owner/admin/member) : スペース内全タスク
--      クライアント(非vendor外部): client_scope='deliverable' のみ（全ball）
--      ベンダー(space role=vendor): client_scope='deliverable' かつ ball <> 'client'
--      ※ NULL client_scope は三値論理で外部に非表示（fail-closed）。
--    ※ この判定は app_can_access_space 相当（space メンバー or org 内部）を内包する＝space アクセス
--      チェックを兼ねる（可視なら必ず space アクセス可）。
-- -----------------------------------------------------------------------------
create or replace function public.app_task_visible_to_actor(p_task_id uuid, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tasks t
    where t.id = p_task_id
      -- app_can_access_space 相当: space メンバー or org 内部メンバー
      and (
        exists (
          select 1 from public.space_memberships sm
          where sm.space_id = t.space_id and sm.user_id = p_actor
        )
        or exists (
          select 1 from public.org_memberships om
          where om.org_id = t.org_id and om.user_id = p_actor and om.role in ('owner','admin','member')
        )
      )
      -- 可視性マトリクス（内部=全件 / 外部=deliverable / vendor は非client-ball）
      and (
        exists (
          select 1 from public.org_memberships omi
          where omi.org_id = t.org_id and omi.user_id = p_actor and omi.role in ('owner','admin','member')
        )
        or (
          t.client_scope = 'deliverable'
          and (
            not exists (
              select 1 from public.space_memberships sv
              where sv.space_id = t.space_id and sv.user_id = p_actor and sv.role = 'vendor'
            )
            or t.ball is distinct from 'client'
          )
        )
      )
  );
$$;
comment on function public.app_task_visible_to_actor(uuid, uuid) is
  'app_task_visible_to_caller の actor 版（service_role 実行の _via_line RPC 用）。解決済み内部ユーザー '
  'p_actor から見た tasks 行の可視性（内部=全件 / クライアント=deliverable / ベンダー=deliverable かつ非client-ball）。'
  'app_can_access_space 相当を内包する。内部専用（service_role）。';


-- -----------------------------------------------------------------------------
-- 1) 完了確認 RPC（§7・クラックスB）
--    返り status: 'done' | 'already_done' | 'blocked' | 'forbidden'
--      done         … このコールで status<>'done'→'done' に遷移し、外部へ complete を enqueue した
--      already_done … 既に done（2連打の2件目/別経路完了）＝友好的冪等成功（enqueue しない＝二重伝搬なし）
--      blocked      … 完了ゲート不成立（spec 未実装 or 未承認 review）。遷移も enqueue もしない
--      forbidden    … authz 不成立（存在しないタスクも情報開示せず forbidden に倒す）
-- -----------------------------------------------------------------------------
create or replace function public.rpc_confirm_task_done_via_line(
  p_channel_account_id uuid,
  p_external_user_id   text,
  p_task_id            uuid
)
returns table (status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task       public.tasks%rowtype;
  v_actor      uuid;
  v_updated    int;
  v_link       record;
begin
  -- タスクを行ロックで読む＝並行する完了確認を直列化する（single-winner の土台）。
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    -- 存在しないタスクは状態を1ビットも開示せず forbidden に倒す（列挙防止）。
    return query select 'forbidden'::text;
    return;
  end if;

  -- authz(1): active な channel_user_link を 口座×外部ユーザー で解決し、内部ユーザーを導出する。
  --   revoked 済みは解決不能。link の org がタスクの org と一致することを要求＝クロステナント遮断。
  --   client 供給の actor は受けない（必ずこの逆引きから actor を得る）。
  select l.user_id into v_actor
  from public.channel_user_links l
  where l.channel_account_id = p_channel_account_id
    and l.external_user_id   = p_external_user_id
    and l.revoked_at is null
    and l.org_id = v_task.org_id;
  if v_actor is null then
    return query select 'forbidden'::text;
    return;
  end if;

  -- authz(2): 紐付けは「キャッシュ」に過ぎず本人性の十分条件ではない（channel_user_links.sql の設計）。
  --   完了のたびに task の org 在籍を再検証する（role 不問＝どのメンバーでも可）。
  if not exists (
    select 1 from public.org_memberships m
    where m.org_id = v_task.org_id and m.user_id = v_actor
  ) then
    return query select 'forbidden'::text;
    return;
  end if;

  -- authz(3): タスク可視性（#1 HIGH）。space アクセス＋client_scope/ball/vendor scope を actor 版で
  --   一括判定する（app_task_visible_to_actor は app_can_access_space 相当を内包）。これが無いと
  --   client/vendor が不可視タスク UUID を差し替えて完了できる。正規フロー（担当者＝元々可視）は無害。
  if not public.app_task_visible_to_actor(p_task_id, v_actor) then
    return query select 'forbidden'::text;
    return;
  end if;

  -- 完了ゲート（正本トリガー enforce_review_gate〔20260706013654_review_integrity.sql〕＋
  --   useTasks.ts:186-195 の assertReviewCompletionGate に整合させる。正本より厳しくすると正当な
  --   完了が LINE から不当に blocked になるため一字一句揃える）:
  --   (a) spec タスクは decision_state='considering'（未決）のときだけ完了不可。decided/implemented は可。
  if v_task.type = 'spec' and v_task.decision_state = 'considering' then
    return query select 'blocked'::text;
    return;
  end if;
  --   (b) review は 'approved'/'cancelled' 以外（open / changes_requested / pending 等）が存在すれば blocked。
  --       'cancelled' は正本が明示的に完了を妨げない（詰んだレビュー取消後の再依頼導線を塞がない）。
  if exists (
    select 1 from public.reviews r
    where r.task_id = p_task_id and r.status not in ('approved', 'cancelled')
  ) then
    return query select 'blocked'::text;
    return;
  end if;

  -- single-winner 遷移: status<>'done' の行だけ done 化する（completed_at は trg_task_completed_at が処理）。
  --   並行2セッションは上の FOR UPDATE で直列化され、2件目は 'done' を観測して 0 行になる。
  --   ※ WHERE の status は返り値 OUT 列 status と曖昧になるためテーブル別名 t で明示修飾する。
  update public.tasks t
    set status = 'done', updated_at = now()
    where t.id = p_task_id and t.status <> 'done';
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    -- 既に done ＝友好的冪等成功。enqueue 分岐に入らない（二重伝搬なし）。
    return query select 'already_done'::text;
    return;
  end if;

  -- 遷移した時だけ、そのタスクの active な外部リンク全件へ complete を enqueue（同トランザクション＝
  --   クラッシュ窓ゼロ）。_enqueue_connector_job が (connection,task) の pending を最新1件に fold する
  --   ため、接続ごと complete はちょうど1件。completionWrite:false の接続は dispatch worker 側で no-op。
  for v_link in
    select connection_id from public.connector_task_links
    where task_id = p_task_id and state = 'active'
  loop
    perform public._enqueue_connector_job(v_link.connection_id, p_task_id, 'complete', '{}'::jsonb);
  end loop;

  -- 監査: task スコープの監査ログ（task_events）に完了を残す。actor は解決済みの内部ユーザー。
  insert into public.task_events (org_id, space_id, task_id, actor_id, action, payload)
  values (
    v_task.org_id, v_task.space_id, p_task_id, v_actor,
    'task.completed_via_line',
    jsonb_build_object('source', 'due_reminder_confirm', 'channel_account_id', p_channel_account_id)
  );

  return query select 'done'::text;
end;
$$;

comment on function public.rpc_confirm_task_done_via_line(uuid, text, uuid) is
  'LINE 完了確認[完了した]の受け口。口座×外部ユーザー→内部ユーザーを channel_user_links から解決し'
  '（revoked除外・org一致・在籍再検証・spaceアクセス確認）、完了ゲート（spec未実装/未承認review→blocked）を'
  '通ったら single-winner で status=done に遷移し、active な connector_task_links 全件へ complete を'
  '同トランザクションで enqueue する。返り: done|already_done|blocked|forbidden。service_role 専用。';


-- -----------------------------------------------------------------------------
-- 2) スヌーズ RPC（§6.1・§7・セキュリティレビュー #2 HIGH＋中）
--    返り status: 'snoozed' | 'already_snoozed' | 'capped' | 'not_found' | 'forbidden'
--      snoozed         … occurrence を pending へ戻し scheduled_at を前進、send_count+1、lease 解放
--      already_snoozed … 世代不一致（古い Flex ボタン再タップ / webhook 再送）＝冪等 no-op
--      capped          … send_count が上限に達している → これ以上再通知せず occurrence を canceled 終端
--      not_found       … occurrence（またはその task）が存在しない
--      forbidden       … authz 不成立
--
--    p_expected_send_count（世代ガード・#2 HIGH リプレイ防止）: 呼び出し側=postback が「送信時の
--      send_count」を渡す。現 send_count と一致する時だけ処理する。古いボタン/再送は send_count が既に
--      進んでいるため 0 行→already_snoozed で握る（最初の1回だけ効く）。
-- -----------------------------------------------------------------------------
create or replace function public.rpc_snooze_due_reminder_via_line(
  p_channel_account_id  uuid,
  p_external_user_id    text,
  p_occurrence_id       uuid,
  p_snooze_days         int,
  p_expected_send_count int
)
returns table (status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- スヌーズ上限（spec §13 open item・仮値）。安全側＝送りすぎない方向に倒す。
  v_max_snooze constant int := 3;
  -- days 上限（RPC 側で強制・#2 中）: postback data は改竄可能なので TS 検証に依存せず 1〜30 にクランプ。
  v_days int := least(greatest(coalesce(p_snooze_days, 1), 1), 30);
  v_occ  public.task_due_reminder_occurrences%rowtype;
  v_org  uuid;
  v_actor uuid;
begin
  -- occurrence を行ロックで読む（並行スヌーズ/送信 finalize と直列化＝世代ガードの原子性の土台）。
  --   READ COMMITTED では、先行 tx が commit すると FOR UPDATE が最新行を再読み込みするため、
  --   2件目は進んだ send_count を観測し世代不一致→already_snoozed になる。
  select * into v_occ
  from public.task_due_reminder_occurrences
  where id = p_occurrence_id
  for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;

  -- occurrence → task → org のチェーンで org を確定する（authz の束縛先）。
  select t.org_id into v_org from public.tasks t where t.id = v_occ.task_id;
  if v_org is null then
    return query select 'not_found'::text;
    return;
  end if;

  -- authz: confirm と同型。口座×外部ユーザーの active リンクが task の org と一致すること＋在籍再検証。
  select l.user_id into v_actor
  from public.channel_user_links l
  where l.channel_account_id = p_channel_account_id
    and l.external_user_id   = p_external_user_id
    and l.revoked_at is null
    and l.org_id = v_org;
  if v_actor is null then
    return query select 'forbidden'::text;
    return;
  end if;
  if not exists (
    select 1 from public.org_memberships m
    where m.org_id = v_org and m.user_id = v_actor
  ) then
    return query select 'forbidden'::text;
    return;
  end if;

  -- authz: タスク可視性（#1 HIGH・confirm と同じ org＋space＋可視性に揃える）。
  if not public.app_task_visible_to_actor(v_occ.task_id, v_actor) then
    return query select 'forbidden'::text;
    return;
  end if;

  -- 世代ガード（#2 HIGH リプレイ防止 ＋ Finding B 完全クローズ）: スヌーズ対象は
  --   「実際に配信された(status='sent')」かつ「send_count が postback の期待世代と一致」する
  --   occurrence だけ。send_count 一致のみだと、正規権限ユーザーが新配信を待たず連投して世代を
  --   自前で 0→1→2 と進め、都度 scheduled_at を +最大30日し最終的に canceled まで持っていける
  --   （リマインドを構造的に黙らせられる）。status='sent' を要求すると、1回スヌーズで occurrence は
  --   'pending' へ再アームされるため、次のスヌーズは sender が実際に再配信して 'sent' に戻るまで
  --   効かず、手動での世代前進が構造的に不可能になる。FOR UPDATE 保持中の比較なので原子的
  --   （正規の二重タップ＝同一 sent occurrence も最初の1回だけ効く挙動は維持）。
  if v_occ.status <> 'sent' or v_occ.send_count is distinct from p_expected_send_count then
    return query select 'already_snoozed'::text;
    return;
  end if;

  -- 上限到達（世代ガード通過後に判定）: これ以上スヌーズさせない → canceled 終端にして 'capped'。
  if v_occ.send_count >= v_max_snooze then
    update public.task_due_reminder_occurrences
      set status = 'canceled', leased_until = null,
          suppress_reason = 'snooze_capped', updated_at = now()
      where id = p_occurrence_id;
    return query select 'capped'::text;
    return;
  end if;

  -- スヌーズ: pending へ戻し scheduled_at を前進、send_count+1、lease 解放。
  --   基準時刻クランプ（#2 中）: 過去の scheduled_at に加算すると受信から>24h後のスヌーズで即再送に
  --   なる穴があるため、基準を greatest(scheduled_at, now()) に取ってから N 日前進させる。
  update public.task_due_reminder_occurrences
    set status       = 'pending',
        scheduled_at = greatest(scheduled_at, now()) + make_interval(days => v_days),
        send_count   = send_count + 1,
        leased_until = null,
        updated_at   = now()
    where id = p_occurrence_id;
  return query select 'snoozed'::text;
end;
$$;

comment on function public.rpc_snooze_due_reminder_via_line(uuid, text, uuid, int, int) is
  'LINE [まだ]/[○日後に再通知]の受け口。occurrence→task→org/space/可視性で authz（confirm と同型）し、'
  'p_expected_send_count の世代ガード（リプレイ防止）を通った上で、send_count 上限未満なら pending へ'
  '差し戻し scheduled_at を greatest(scheduled_at,now())+N日（days は1〜30にクランプ）・send_count+1・'
  'lease 解放（snoozed）、世代不一致は already_snoozed、上限到達は canceled（capped）。'
  '返り: snoozed|already_snoozed|capped|not_found|forbidden。service_role 専用。';


-- -----------------------------------------------------------------------------
-- 3) 権限: 両関数とも service role 専用にする（§7・既存 _via_line RPC と同作法）。
--    Postgres は新規関数の EXECUTE を既定で PUBLIC に付与するため、明示 revoke しないと
--    anon/authenticated が SECURITY DEFINER の RPC を直接叩けてしまう。
-- -----------------------------------------------------------------------------
revoke all on function public.app_task_visible_to_actor(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.rpc_confirm_task_done_via_line(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.rpc_snooze_due_reminder_via_line(uuid, text, uuid, int, int)
  from public, anon, authenticated;

grant execute on function public.app_task_visible_to_actor(uuid, uuid) to service_role;
grant execute on function public.rpc_confirm_task_done_via_line(uuid, text, uuid) to service_role;
grant execute on function public.rpc_snooze_due_reminder_via_line(uuid, text, uuid, int, int) to service_role;
