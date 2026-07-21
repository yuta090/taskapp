-- =============================================================================
-- タスク同期プロバイダ受け入れのための integration_connections 拡張
--
-- 背景:
--   これまでの provider は全て OAuth・単一エンドポイント・org あたり1接続で足りていた
--   （google_calendar / zoom / notion / google_sheets / google_tasks / multica）。
--   Backlog / Jira / Redmine / Jooto / Asana / Trello / Linear といったタスク同期先を
--   受け入れると、この3つの前提がいずれも崩れる:
--     (a) 資格情報が OAuth とは限らない（API キー / PAT は失効も更新もされない）
--     (b) 接続先ホストがテナントごとに可変（Backlog のスペースURL・Redmine の自ホスト）
--     (c) 同一 org が同じツールの別テナントへ複数接続しうる（親会社/子会社の別スペース等）
--   本 migration はこの3点を器として受けるだけで、どのツールを実際に繋ぐかは持たない。
--
-- この migration の範囲:
--   - integration_connections への列追加（auth_kind / base_url / external_account_key）
--   - 既存 multica 行の auth_kind backfill
--   - provider CHECK を「列挙」から「識別子の形式チェック」へ置換
--   - 一意制約を (provider, owner_type, owner_id) から
--     (provider, owner_type, owner_id, coalesce(external_account_key,'')) の式一意インデックスへ置換
--   - base_url のイミュータブル化トリガー
--   - external_account_key の逆引き用部分インデックス
-- スコープ外:
--   - 資格情報の実体の置き場（API キー / PAT は既存の access_token_encrypted 列に
--     そのまま格納する。専用テーブルは作らない）
--   - 各ツールのアダプタ実装・スコープ/権限の検証
--
-- 適用: アプリ稼働中に適用可。ただし**完全な無ロックではない**:
--   4) の unique index 作成は CONCURRENTLY ではないため、作成中は integration_connections への
--   書き込みが待たされる。この表は「org × provider につき原則1行」で、規模が数千行を超えない
--   （接続はユーザー数ではなく組織数に比例する）ため、待ちはミリ秒〜秒のオーダーに収まる想定。
--   将来この表が桁違いに大きくなった場合は CONCURRENTLY への切替が必要（ただし CONCURRENTLY は
--   トランザクション内で実行できないため、migration ランナー側の対応も要る）。
--   既存行の値は multica の auth_kind backfill を除いて変更しない。
--
-- ロールバック / 不可逆性:
--   - 列追加・インデックス・トリガーは drop で可逆。
--   - provider CHECK の緩和は「一度緩めた後に新 provider の行が入ると、
--     旧列挙 CHECK へは戻せない」という意味で実質不可逆（戻すには当該行の削除が要る）。
--   - 一意制約の緩和も同様: external_account_key 付きの複数接続が入った後に
--     旧 unique(provider, owner_type, owner_id) へは戻せない。
--   - multica の auth_kind backfill は値の上書きなので、戻すなら 'oauth' へ再更新が必要
--     （元の値は default の 'oauth' なので情報損失はない）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) 列の追加
--    いずれも not null default 付き（auth_kind）または nullable なので、
--    既存行の書き換えを伴わず稼働中に追加できる。
-- -----------------------------------------------------------------------------
alter table public.integration_connections
  add column if not exists auth_kind text not null default 'oauth'
    check (auth_kind in ('oauth', 'api_key', 'shared_secret')),
  add column if not exists base_url text null,
  add column if not exists external_account_key text null;

-- auth_kind: 資格情報の「寿命管理の差」を表す。実体（トークン/APIキー/PAT）は方式によらず
--   access_token_encrypted に入れるが、OAuth は refresh_token で更新でき期限切れを検知できるのに対し、
--   api_key/PAT は更新も期限もない。この差を列で持たないと、リフレッシュ処理が
--   refresh_token を持たない接続を「壊れた OAuth 接続」と誤認して revoke しに行く。
comment on column public.integration_connections.auth_kind is
  '資格情報の方式。oauth=更新可能なトークン / api_key=APIキー・PAT(更新も期限もない) / shared_secret=相互鍵(multica)。実体はいずれも access_token_encrypted に格納し、この列は寿命管理の分岐にのみ使う。';

-- base_url: 接続先ホストがテナントごとに可変なツール用（Backlog のスペースURL、Redmine の自ホスト）。
--   provider から一意にエンドポイントが決まる前提のツール（Trello/Linear/Asana 等）では null のまま。
--   metadata jsonb に入れないのは、宛先が「資格情報を送りつける先」という安全上の第一級要素であり、
--   下の immutable トリガーで守る対象を列として固定したいため。
comment on column public.integration_connections.base_url is
  '接続先のベースURL。ホストがテナントごとに可変なツール（Backlog のスペースURL / Redmine の自ホスト）のみ設定。設定済みの値は変更不可（integration_connections_validate_endpoint_immutable）。';

-- external_account_key: 外部側テナントの正規化識別子。
--   「どの外部テナントに繋いでいるか」を provider ごとの流儀に依存せず1つの値で表すことで、
--   下の一意インデックスが「同じ org が同じ外部テナントへ二重に繋ぐ」事故を構造的に防げる。
--   正規化して入れるのは呼び出し側の責務（Backlog=スペースホストの小文字化 / Jira=cloudId /
--   Redmine=正規化した base_url）。表記揺れのまま入れると重複検知が効かない。
comment on column public.integration_connections.external_account_key is
  '外部側テナントの正規化識別子（Backlog=スペースホスト小文字化 / Jira=cloudId / Redmine=正規化base_url）。1 org が同一ツールの複数テナントへ繋ぐ場合の識別に使う。単一テナント前提の provider は null。';

-- -----------------------------------------------------------------------------
-- 2) 既存行の backfill
--    multica は相互に鍵を交換する方式で OAuth ではない。default 'oauth' のまま残すと
--    上記の「refresh_token が無い＝壊れた接続」誤判定の対象になるため、ここで正す。
--    他の既存 provider は全て OAuth なので default のままでよい。
-- -----------------------------------------------------------------------------
update public.integration_connections
  set auth_kind = 'shared_secret'
  where provider = 'multica'
    and auth_kind <> 'shared_secret';  -- 再適用時に無駄な UPDATE を発生させない

-- -----------------------------------------------------------------------------
-- 3) provider の CHECK を「列挙」から「形式チェック」へ
--    列挙 CHECK は 20260214 / 20260711 / 20260718 / 20260720 と既に4回入れ替わっており、
--    値を1つ増やすたびに migration を打つ運用になっている。対応ツールが数十規模になる前提とは
--    釣り合わず、実質「typo 番兵」以上の仕事をしていない。
--    真実源は TS 側（src/lib/integrations/registry.ts の IntegrationId とアダプタ登録表）へ一本化し、
--    DB は識別子の形式（小文字英数とアンダースコア）だけを見る。
--    ⚠ 緩めた分の担保はアプリ側に移る:
--      - 接続を作る唯一の経路（/api/integrations/connections/task-sync）が登録表で provider を検証して
--        弾く（未知の値は 400）。ここが実質の門番。
--      - それでも未知 provider の行が入り込んだ場合、取り込みワーカーはその接続を「対象外」として
--        飛ばす。黙って飛ばすと「接続済みに見えるのに永久に同期されない」状態が観測できないため、
--        ワーカーは skip 理由として記録する（src/lib/task-sync/runner.ts の unknown_provider）。
-- -----------------------------------------------------------------------------
alter table public.integration_connections
  drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections
  add constraint integration_connections_provider_check
  check (provider ~ '^[a-z][a-z0-9_]{1,63}$');

-- -----------------------------------------------------------------------------
-- 4) 一意制約の置き換え: 1 org が同一ツールの複数テナントへ繋げるようにする
--    旧: unique (provider, owner_type, owner_id) ＝ 1 org 1 ツール 1 接続。
--    新: 上記に外部テナント識別子を加える。
--
--    coalesce(external_account_key, '') が肝:
--      Postgres の unique は NULL 同士を重複とみなさないため、素直に4列 unique にすると
--      key 未設定の provider が無制限に複数接続できてしまい、旧制約より緩くなる。
--      coalesce で NULL を単一値 '' に潰すことで、
--        - 既存 provider（google_calendar/zoom/notion/google_sheets/google_tasks/multica。
--          全行 key=NULL）は従来どおり 1 接続のまま
--        - key を持つ新 provider だけが複数接続を開く
--      という非対称な緩和になる。既存データ無変更・無停止で移行できる。
--      副次効果として「同じ org が同じ Backlog スペースを2回繋ぐ」二重取り込み事故も制約で防げる。
-- -----------------------------------------------------------------------------

-- 旧 unique は 20260214_000_integration_connections.sql:24 のテーブル定義由来（自動命名）。
-- 実名は integration_connections_provider_owner_type_owner_id_key（ローカル実DBで確認済）だが、
-- 自動命名は環境差で揺れうるため、名前決め打ちではなく列構成から実体を引いて落とす。
do $$
declare
  v_conname text;
begin
  select c.conname into v_conname
  from pg_constraint c
  where c.conrelid = 'public.integration_connections'::regclass
    and c.contype = 'u'
    and (
      select array_agg(a.attname::text order by a.attname)
      from unnest(c.conkey) as k
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
    ) = array['owner_id', 'owner_type', 'provider']
  limit 1;

  if v_conname is not null then
    execute format('alter table public.integration_connections drop constraint %I', v_conname);
  end if;
  -- 見つからない場合は再適用（既に落とし済み）なので何もしない。
end;
$$;

create unique index if not exists integration_connections_provider_owner_account_uniq
  on public.integration_connections (provider, owner_type, owner_id, coalesce(external_account_key, ''));

comment on index public.integration_connections_provider_owner_account_uniq is
  '接続の重複防止。coalesce で NULL を '''' に潰すことで、key 未設定の既存 provider は 1 接続のまま、外部テナント識別子を持つ provider だけ複数接続を許す。';

-- -----------------------------------------------------------------------------
-- 5) base_url のイミュータブル化
--    資格情報（APIキー/PAT）を保持したまま宛先だけをすり替えられると、鍵をそのまま
--    攻撃者のホストへ送らせられる。接続先の変更は「接続の作り直し」（削除して再作成し、
--    鍵も入れ直す）であるべきなので、UPDATE 経路を DB 側で閉じる。
--    RLS＝誰が書けるか / トリガー＝何を書けるか、の責務分離は
--    20260720181730_connector_import_config_validation.sql と同じ姿勢。
--    NULL → 非NULL（初期設定）だけは許可する。非NULL → NULL（クリアして入れ直す抜け道）も拒否する。
--    external_account_key も同じトリガーで不変にする（理由は関数内コメント）。
-- -----------------------------------------------------------------------------
create or replace function public.integration_connections_validate_endpoint_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 他テーブルを参照しないため definer の実効的な権限昇格はないが、同居トリガーと様式を揃え、
  -- search_path 固定で関数/演算子解決を安定させる。
  if old.base_url is not null and new.base_url is distinct from old.base_url then
    raise exception 'base_url is immutable once set (connection %); recreate the connection to change the endpoint', old.id;
  end if;
  -- external_account_key も同じ理由で不変にする。可変だと、一意インデックスの意味が崩れる:
  -- 既存 provider（key=NULL 前提で1接続に制限されている）の行に後から key を付ければ、
  -- 同じ provider/owner で好きなだけ接続を増やせてしまう（＝二重取り込みの抜け道）。
  -- 値はサーバー側が接続先URLから決定的に導出するものであり、後から変える正当な理由がない。
  if old.external_account_key is not null
     and new.external_account_key is distinct from old.external_account_key then
    raise exception 'external_account_key is immutable once set (connection %)', old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists integration_connections_validate_base_url_immutable
  on public.integration_connections;
drop trigger if exists integration_connections_validate_endpoint_immutable
  on public.integration_connections;

create trigger integration_connections_validate_endpoint_immutable
  before update on public.integration_connections
  for each row
  execute function public.integration_connections_validate_endpoint_immutable();

-- -----------------------------------------------------------------------------
-- 6) external_account_key の逆引き索引
--    Webhook / コールバックは外部テナント識別子しか名乗らないことがあり、そこから接続を引く。
--    key を持たない既存 provider の行（全体の大半）を含めない部分インデックスにする。
-- -----------------------------------------------------------------------------
create index if not exists integration_connections_provider_account_idx
  on public.integration_connections (provider, external_account_key)
  where external_account_key is not null;

-- =============================================================================
-- 適用後に成り立つべき不変条件（検証済み）:
--   (a) 既存 provider（key=NULL）で同一 provider/owner の2件目 INSERT は一意違反で失敗する
--   (b) external_account_key を設定すれば同一 provider/owner でも複数接続でき、
--       同一 key の重複だけが拒否される
--   (c) 設定済み base_url / external_account_key の UPDATE は例外で拒否される
--       （NULL→非NULL の初期設定は通る）
--   (d) 既存 multica 行の auth_kind が 'shared_secret' に backfill されている
--   (e) 本ファイルを再適用しても壊れない（列・索引・トリガー・制約すべて冪等）
-- =============================================================================
