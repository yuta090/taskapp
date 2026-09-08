-- =============================================================================
-- 事務所(org)ごとの招待メール文面（org_email_templates）
--
-- 目的: 招待フォームで「いまの文面」を見て、その場で直して送れるようにする。
--   既定はその1通かぎりの差し替え。「テンプレートとして保存する」を選んだときだけ
--   事務所の文面としてここに残り、以降の招待メールの初期値になる。
--
-- 解決順序: 事務所の保存(このテーブル) → 運営の保存(email_templates) → コード既定(registry.ts)
--
-- アクセス境界（email_templates と同じ作法）:
--   RLS 有効・ポリシーを一切作らない ＋ anon/authenticated から revoke all
--   = service role 以外は直接読めない・書けない。
--   読み: server 側 createAdminClient（src/lib/email/templates/orgEmailTemplate.ts）
--   書き: 下の SECURITY DEFINER RPC のみ（org の owner/admin だけ）
--
--   ★ email_templates（プラットフォーム共通・運営専用）は一切変更しない。
--     事務所の管理者が運営の共通文面を上書きできてはいけないので、器を分ける。
--
-- 対象キーを招待の2つに限っているのは、事務所が触ってよいのが「自分が送る招待」だけのため。
-- 承認依頼・請求・認証メールなどは運営の文面のまま（キーを増やすときは CHECK を広げる）。
--
-- 冪等・加算的: 新規テーブルと新規関数のみ。既存の読み書き経路は挙動不変。
-- ロールバック: drop table / drop function で可逆。ただし保存された文面は事務所のデータなので
--   機能を畳むときも黙って消さない。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) テーブル
-- -----------------------------------------------------------------------------
create table if not exists public.org_email_templates (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  key         text not null check (key in ('invite_client', 'invite_member')),
  subject     text not null,
  heading     text not null,
  body        text not null,
  cta_label   text not null,
  note        text not null default '',
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (org_id, key),

  -- TypeScript 側の validateTemplateFields と同じ物差しを DB にも置く。
  -- 画面/API を通さず RPC を直接叩かれても、壊れた文面が残らないようにするため。
  constraint org_email_templates_len_chk check (
    char_length(subject) between 1 and 200
    and char_length(heading) between 1 and 100
    and char_length(body) between 1 and 4000
    and char_length(cta_label) between 1 and 60
    and char_length(note) <= 500
  ),
  -- 改行を許すのは本文だけ（件名に改行が混ざるとヘッダが壊れる）
  constraint org_email_templates_single_line_chk check (
    subject !~ E'[\r\n]' and heading !~ E'[\r\n]' and cta_label !~ E'[\r\n]' and note !~ E'[\r\n]'
  )
);

comment on table public.org_email_templates is
  '事務所ごとの招待メール文面。行が無いキーは運営の共通文面(email_templates)→コード既定の順で使う。service role 専用（RLS有効・ポリシー無し）。書込は rpc_set_org_email_template 経由のみ';
comment on column public.org_email_templates.key is
  'テンプレートのキー。事務所が触れるのは自分が送る招待メールだけ（invite_client / invite_member）';

alter table public.org_email_templates enable row level security;

-- ポリシーは作らない。既定 GRANT も落として到達させない
revoke all on table public.org_email_templates from anon, authenticated;


-- -----------------------------------------------------------------------------
-- 2) 保存（org の owner/admin のみ）
--
-- 直接 upsert を開けない理由は org_channel_policy と同じ（20260721215120 の判断記録）:
--   PostgREST の upsert は ON CONFLICT の SET 句に PK を含めるため列 GRANT 方式が動かない。
--   ここでは「この5項目だけを書く」動作を RPC に固定する。
--
-- 検証の分担: 必須・長さ・改行はここ（上の CHECK と合わせて DB で担保）。
--   使えない差し込み語の検査は TypeScript 側（validateTemplateFields）に置く。
--   未知の差し込み語は `{{そのまま}}` と表示されるだけで、権限や安全性の問題にはならないため。
-- -----------------------------------------------------------------------------
create or replace function public.rpc_set_org_email_template(
  p_org_id    uuid,
  p_key       text,
  p_subject   text,
  p_heading   text,
  p_body      text,
  p_cta_label text,
  p_note      text
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  -- UI/API の判定に頼らず、ここでも権限を確かめる（RPC は authenticated から直接呼べるため）
  if v_actor is null or not public.app_is_org_owner_or_admin(p_org_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  insert into public.org_email_templates (
    org_id, key, subject, heading, body, cta_label, note, updated_by, updated_at
  )
  values (
    p_org_id, p_key, p_subject, p_heading, p_body, p_cta_label, coalesce(p_note, ''), v_actor, now()
  )
  on conflict (org_id, key) do update
    set subject    = excluded.subject,
        heading    = excluded.heading,
        body       = excluded.body,
        cta_label  = excluded.cta_label,
        note       = excluded.note,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;
end;
$$;

comment on function public.rpc_set_org_email_template(uuid, text, text, text, text, text, text) is
  '事務所の招待メール文面を保存する唯一の経路。org の owner/admin のみ。書くのは文面5項目と更新者・更新時刻だけ';

revoke all on function public.rpc_set_org_email_template(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.rpc_set_org_email_template(uuid, text, text, text, text, text, text) to authenticated;


-- -----------------------------------------------------------------------------
-- 3) 既定に戻す（行を消す = 運営の共通文面／コード既定に戻る）
-- -----------------------------------------------------------------------------
create or replace function public.rpc_reset_org_email_template(
  p_org_id uuid,
  p_key    text
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if auth.uid() is null or not public.app_is_org_owner_or_admin(p_org_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  delete from public.org_email_templates where org_id = p_org_id and key = p_key;
end;
$$;

comment on function public.rpc_reset_org_email_template(uuid, text) is
  '事務所の招待メール文面の保存を消して既定に戻す。org の owner/admin のみ';

revoke all on function public.rpc_reset_org_email_template(uuid, text) from public, anon;
grant execute on function public.rpc_reset_org_email_template(uuid, text) to authenticated;

-- =============================================================================
-- ロールバック（必要時に手で流す）
--   drop function if exists public.rpc_reset_org_email_template(uuid, text);
--   drop function if exists public.rpc_set_org_email_template(uuid, text, text, text, text, text, text);
--   drop table if exists public.org_email_templates;
-- =============================================================================
