-- =============================================================================
-- 見積書・請求書の発行記録
--
-- 対象範囲（厳守）: 外部の会計/請求サービス（freee請求書 / マネーフォワード クラウド請求書 /
-- Misoca）に対して **見積書・請求書を作ること** と、**その状態を取り込むこと** だけを扱う。
-- 仕訳・入出金・経費・決算といった会計データ全般はこのスキーマの対象外。
--
-- ここで守りたい不変条件は1つに尽きる: **二重発行しない**。
-- 同じ請求書が2通、取引先に届くのは謝って済む話ではない（入金消込が壊れ、信用を落とす）。
-- ネットワークの再送・ユーザーの二度押し・ブラウザの復元のいずれでも起きうるため、
-- アプリ側の「送信中は押せない」では防げない。DBの一意制約で物理的に止める。
--
-- 破壊的変更なし: 新規テーブルのみ。既存テーブル/ポリシーには触れない。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 発行先の対応付け（スペース ↔ 会計サービス側の取引先）
--
-- 取引先を TaskApp から**自動作成しない**（人が既存の取引先から1度選ぶ）。会計側の取引先
-- マスタは請求・入金消込の土台で、表記ゆれた重複行が増えると経理の実務が壊れるため。
-- -----------------------------------------------------------------------------
create table if not exists public.accounting_partner_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  -- どのサービスか。registry.ts の accounting カテゴリのIDと一致させる
  provider text not null check (provider in ('freee', 'money_forward', 'misoca')),
  -- 発行に使う接続（トークンの持ち主）。接続が消えたら対応付けも意味を失う
  connection_id uuid references public.integration_connections(id) on delete cascade,
  -- 会計サービス側の取引先ID（freee=partner_id / MF=partner id / Misoca=contact_group_id）
  external_partner_id text not null,
  -- 画面表示用の控え。会計側で改名されうるので正本ではない
  external_partner_name text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1スペース×1サービスにつき発行先は1つ。複数あると「どちらに出したか」が曖昧になる
create unique index if not exists accounting_partner_links_space_provider_unique
  on public.accounting_partner_links(space_id, provider);

create index if not exists idx_accounting_partner_links_org
  on public.accounting_partner_links(org_id);

comment on table public.accounting_partner_links is
  'スペースと会計サービス側の取引先の対応付け。取引先はTaskAppから自動作成せず、既存から人が選ぶ。書込=service roleのみ・読取=内部メンバーのみ';

-- -----------------------------------------------------------------------------
-- 2. 発行記録（二重発行を止める要）
-- -----------------------------------------------------------------------------
create table if not exists public.billing_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  provider text not null check (provider in ('freee', 'money_forward', 'misoca')),
  doc_type text not null check (doc_type in ('quote', 'invoice')),

  -- 冪等キー: 発行内容（スペース・種別・対象タスク・金額・発行日）から決まる。
  -- 同じ内容の再送は同じ鍵になり、下の一意制約で2通目が物理的に作られない。
  -- 意図的な再発行は発行日か内容が変わるため別の鍵になり、妨げない。
  idempotency_key text not null,

  -- 外部側の識別子。作成要求は通ったが応答を取りこぼした場合に備え null 許容にし、
  -- 状態同期で埋め直せるようにする（「送ったか分からない」を残さないため）
  external_id text,
  document_number text,

  -- TaskApp の語彙に畳んだ状態。畳めなかったものは 'unknown' に落とす
  -- （知らない状態を issued/paid に寄せると、未入金の請求を入金済みと誤認する）
  status text not null default 'unknown'
    check (status in ('draft', 'issued', 'paid', 'accepted', 'canceled', 'unknown')),
  -- 外部が返した生の状態。畳み方を後から直すときの原因調査に要る
  raw_status text,

  total_amount numeric(14,2),
  web_url text,

  issued_by uuid references auth.users(id),
  issued_at timestamptz,
  -- 最後に外部へ状態を確認しに行った時刻（入金確認のcronが使う）
  remote_synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 二重発行の物理的な歯止め。アプリ側の制御ではなくここで止める
create unique index if not exists billing_documents_idempotency_unique
  on public.billing_documents(org_id, provider, doc_type, idempotency_key);

create index if not exists idx_billing_documents_space
  on public.billing_documents(space_id, doc_type);

-- 状態同期cronの拾い先: まだ確定していない書類を古い順に見る
create index if not exists idx_billing_documents_pending_sync
  on public.billing_documents(remote_synced_at)
  where status in ('draft', 'issued', 'unknown');

comment on table public.billing_documents is
  '見積書・請求書の発行記録。(org_id, provider, doc_type, idempotency_key) の一意制約で二重発行を物理的に止める。書込=service roleのみ・読取=内部メンバーのみ';
comment on column public.billing_documents.idempotency_key is
  '発行内容から決まる冪等キー。二度押し・再送で同じ値になり2通目が作られない。意図的な再発行は内容が変わるため別値になる';
comment on column public.billing_documents.status is
  'TaskApp語彙の状態。外部の未知ステータスは unknown に落とす（入金済みと誤認させない）';

-- -----------------------------------------------------------------------------
-- 3. 書類に含めたタスク（二重請求の検知に使う）
--
-- 「このタスクはもう請求済み」を答えられるようにする。同じ作業を2回請求するのは
-- 二重発行と同じくらい実害が大きいが、こちらは**禁止ではなく警告**にとどめる
-- （分割請求・再請求という正当な業務があるため、止めるのではなく気づかせる）。
-- -----------------------------------------------------------------------------
create table if not exists public.billing_document_tasks (
  document_id uuid not null references public.billing_documents(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  primary key (document_id, task_id)
);

-- 「このタスクは既にどの書類に載ったか」を引く向き
create index if not exists idx_billing_document_tasks_task
  on public.billing_document_tasks(task_id);

comment on table public.billing_document_tasks is
  '書類に含めたタスクの対応表。同じタスクの二重請求を検知して警告するために使う（発行の禁止はしない＝分割請求・再請求は正当な業務）';

-- -----------------------------------------------------------------------------
-- RLS: 書込=service roleのみ / 読取=内部メンバーのみ
--
-- 金額と取引先が入るため、client ロール（顧客）からは一切見せない。既存の
-- app_is_org_internal() が「その org の内部メンバーか」の唯一の判定。
-- -----------------------------------------------------------------------------
alter table public.accounting_partner_links enable row level security;
alter table public.billing_documents enable row level security;
alter table public.billing_document_tasks enable row level security;

revoke all on table public.accounting_partner_links from anon, authenticated;
revoke all on table public.billing_documents from anon, authenticated;
revoke all on table public.billing_document_tasks from anon, authenticated;

grant select on table public.accounting_partner_links to authenticated;
grant select on table public.billing_documents to authenticated;
grant select on table public.billing_document_tasks to authenticated;

drop policy if exists accounting_partner_links_select_internal on public.accounting_partner_links;
create policy accounting_partner_links_select_internal
  on public.accounting_partner_links
  for select
  to authenticated
  using (public.app_is_org_internal(accounting_partner_links.org_id));

drop policy if exists billing_documents_select_internal on public.billing_documents;
create policy billing_documents_select_internal
  on public.billing_documents
  for select
  to authenticated
  using (public.app_is_org_internal(billing_documents.org_id));

drop policy if exists billing_document_tasks_select_internal on public.billing_document_tasks;
create policy billing_document_tasks_select_internal
  on public.billing_document_tasks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.billing_documents d
      where d.id = billing_document_tasks.document_id
        and public.app_is_org_internal(d.org_id)
    )
  );

-- =============================================================================
-- 検証（適用後に実施）:
--   1) 二重発行の遮断: 同じ (org_id, provider, doc_type, idempotency_key) の2回目 insert が
--      一意制約違反になる。
--   2) 再発行は妨げない: idempotency_key が異なれば同じスペース・同じタスクでも insert できる。
--   3) 越境なし: 他orgの行が、その org の内部メンバーでない authenticated から 0行。
--   4) 顧客に見えない: client ロールのユーザーから 3テーブルとも 0行。
--   5) 書込閉塞: authenticated からの insert/update/delete が RLS/権限で拒否される。
--   6) 破壊的変更なし: 新規テーブルのみ。既存テーブル/ポリシーの変更なし。
-- =============================================================================
