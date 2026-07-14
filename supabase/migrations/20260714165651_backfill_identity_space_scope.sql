-- =============================================================================
-- fix: rpc_backfill_digest_assignee_identity を顧問先(space)スコープに限定する
--
-- 20260714153028_digest_due_assignee.sql で入れた版は (org_id, external_id) だけで
-- 突合しており、org内の**全space**のopen申し送りを更新していた。
--
-- channel_identities は「同一人物が複数顧問先の窓口になるケース（社長が2法人経営等）」を
-- space 違いで明示的に許容している（active一意 = (org_id, channel, external_id, space_id)、
-- 20260710204722_channel_plumbing.sql:72 のコメント参照）。
-- そのため旧版では、A社の窓口としてidentityが作られた瞬間に、**B社（別顧問先）の申し送り**まで
-- そのidentityに紐付き、顧問先をまたいだ担当の誤帰属が起きる。
--
-- 対策: identity の space_id と一致する申し送りだけを更新する。
-- （channel_digest_tasks.space_id は group からデノーマライズ済み）
-- =============================================================================

create or replace function public.rpc_backfill_digest_assignee_identity(
  p_identity_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_space_id uuid;
  v_external_id text;
  v_channel text;
  v_updated int := 0;
begin
  select org_id, space_id, external_id, channel
    into v_org_id, v_space_id, v_external_id, v_channel
  from channel_identities
  where id = p_identity_id and status = 'active';

  -- assignee_external_user_id はLINEのuserIdしか入らない。
  -- 他チャネル（emailのアドレス等）のidentityで誤って突合しないようチャネルを固定する
  if v_org_id is null or v_channel <> 'line' then
    return 0;
  end if;

  update channel_digest_tasks
  set assignee_identity_id = p_identity_id
  where org_id = v_org_id
    -- ★顧問先スコープ。これが無いと別顧問先の申し送りに担当が付く
    and space_id = v_space_id
    and status = 'open'
    and assignee_identity_id is null
    and assignee_external_user_id = v_external_id;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke execute on function public.rpc_backfill_digest_assignee_identity(uuid) from public, anon, authenticated;
grant execute on function public.rpc_backfill_digest_assignee_identity(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 既存データの是正
-- -----------------------------------------------------------------------------
-- 旧版RPCが別顧問先の申し送りに付けてしまった assignee_identity_id を剥がす。
--
-- ★status で絞らない（open/done/dismissed すべて対象）。
-- 「done済みの履歴は書き換えない」原則は *正しい帰属* に対するもの。
-- ここで剥がすのは旧RPCが後付けした *事実誤認*（task.space_id と identity.space_id が
-- 食い違う＝別顧問先の人が担当ということはあり得ない）であり、当時正しかった記録ではない。
-- 残すと担当者別の検索・監査・将来のtasks昇格で誤集計され続ける。
update channel_digest_tasks t
set assignee_identity_id = null
from channel_identities i
where t.assignee_identity_id = i.id
  and t.space_id is distinct from i.space_id;

-- -----------------------------------------------------------------------------
-- rpc_link_group_to_space — グループのspace確定時に、既存申し送りの担当も解決する
-- -----------------------------------------------------------------------------
-- 旧版は space_id を埋めるだけで assignee_identity_id を解決していなかった。
-- 未紐付けグループで作られた申し送りは identity 解決を保留（space未確定のため）しており、
-- その後 identity 作成イベントも起きないため、**永久に assignee_identity_id が null のまま**
-- になっていた（Codexレビュー指摘）。space が確定した今こそ解決できる。
--
-- ベースは 20260711073329_channel_groups_digest.sql の最新定義
-- （関数を再定義する migration は必ず直前の最新定義を土台にする — 過去に後発ファイルが
--   認可チェックを脱落させた実害があるため）。
create or replace function public.rpc_link_group_to_space(
  p_group_id uuid,
  p_space_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
  v_linked boolean;
  v_org_id uuid;
begin
  update channel_groups
  set space_id = p_space_id
  where id = p_group_id
    and space_id is null;

  get diagnostics v_rows = row_count;
  v_linked := v_rows > 0;

  if v_linked then
    select org_id into v_org_id from channel_groups where id = p_group_id;

    update channel_messages
    set space_id = p_space_id
    where group_id = p_group_id
      and space_id is null;

    update channel_digest_tasks
    set space_id = p_space_id
    where group_id = p_group_id
      and status = 'open'
      and space_id is null;

    -- space が確定したので、生のLINE userId しか持っていない申し送りを identity へ解決する。
    -- 確定した space のidentityだけを見る（他顧問先のidentityは引かない）
    update channel_digest_tasks t
    set assignee_identity_id = i.id
    from channel_identities i
    where t.group_id = p_group_id
      and t.status = 'open'
      and t.assignee_identity_id is null
      and t.assignee_external_user_id is not null
      and i.org_id = v_org_id
      and i.space_id = p_space_id
      and i.channel = 'line'
      and i.status = 'active'
      and i.external_id = t.assignee_external_user_id;
  end if;

  return v_linked;
end;
$$;

revoke execute on function public.rpc_link_group_to_space(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_link_group_to_space(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 既存 channel_messages の誤帰属も是正する（Codexレビュー3周目の指摘）
-- -----------------------------------------------------------------------------
-- 旧 processGroupMessage は org内identityの先頭[0]を無条件採用していたため、
-- channel_messages.identity_id にも別顧問先のidentityが入り得た（発言者の誤表示）。
--
-- guardトリガー（trg_channel_messages_guard）は identity_id の非NULL→変更を例外にするため、
-- 一時停止して是正する。是正は「space_id と identity.space_id が食い違う行」だけを対象にする
-- （原理的にあり得ない組み合わせ＝旧バグの産物）。停止と再有効化は同一トランザクション内。
alter table public.channel_messages disable trigger trg_channel_messages_guard;

update channel_messages m
set identity_id = null
from channel_identities i
where m.identity_id = i.id
  and m.space_id is distinct from i.space_id;

alter table public.channel_messages enable trigger trg_channel_messages_guard;

-- -----------------------------------------------------------------------------
-- 帰属をDB側で導出する（アプリのレースに依存しない・Codexレビュー3周目の指摘）
-- -----------------------------------------------------------------------------
-- レース: webhookイベントAが「未紐付け」のgroupを読んだ直後に、イベントBのリンクRPCが
-- space確定＋バックフィルを完了する。その後Aが古い spaceId=null のままINSERTすると、
-- そのメッセージ／申し送りは二度と拾われない（バックフィルは既に走り終えている）。
--
-- アプリ側で読んだ値を信用せず、**INSERT時にDBの最新のgroupから導出**することで根治する。
-- テーブルごとに関数を分ける。1つの汎用トリガー関数に tg_table_name の分岐で押し込むと、
-- PL/pgSQL が IF 条件の record フィールド参照を評価する際、その列を持たないテーブルで
-- 実行時に 'record "new" has no field ...' で落ちる（実行検証で発覚。定義時には通ってしまう）。

create or replace function public.channel_messages_derive_space()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id uuid;
begin
  -- space は常にグループ由来（identityからは絶対に導出しない。既存の不変条件）
  if new.group_id is not null and new.space_id is null then
    select space_id into v_space_id from channel_groups where id = new.group_id;
    new.space_id := v_space_id;
  end if;
  return new;
end;
$$;

create or replace function public.channel_digest_tasks_derive_attribution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id uuid;
begin
  if new.group_id is not null and new.space_id is null then
    select space_id into v_space_id from channel_groups where id = new.group_id;
    new.space_id := v_space_id;
  end if;

  -- 担当identityは、確定した space の中だけで解決する（顧問先境界を越えない）
  if new.assignee_identity_id is null
     and new.assignee_external_user_id is not null
     and new.space_id is not null then
    select i.id into new.assignee_identity_id
    from channel_identities i
    where i.org_id = new.org_id
      and i.space_id = new.space_id
      and i.channel = 'line'
      and i.status = 'active'
      and i.external_id = new.assignee_external_user_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_channel_messages_derive_space on public.channel_messages;
create trigger trg_channel_messages_derive_space
  before insert on public.channel_messages
  for each row execute function public.channel_messages_derive_space();

-- sink配信トリガー(trg_channel_digest_tasks_enqueue_sink_deliveries)は AFTER INSERT のため、
-- この BEFORE トリガーで導出した確定値を見る
drop trigger if exists trg_channel_digest_tasks_derive_attribution on public.channel_digest_tasks;
create trigger trg_channel_digest_tasks_derive_attribution
  before insert on public.channel_digest_tasks
  for each row execute function public.channel_digest_tasks_derive_attribution();

-- =============================================================================
-- 巻き戻しについて（forward fix が標準手順）
--
-- 旧版RPCの再適用は**既知の誤帰属バグを復活させる**ため行わない。
-- また上の是正UPDATEで剥がした assignee_identity_id は復元できない
-- （元々が誤った値であり、復元する価値もない）。
-- 問題が出た場合は、このファイルを土台に修正版を新しい migration として前進適用すること。
-- =============================================================================
