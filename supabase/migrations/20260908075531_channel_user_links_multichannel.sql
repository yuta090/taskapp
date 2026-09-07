-- =============================================================================
-- channel_user_links をマルチチャネル対応にする（Slack の本人紐づけ・code review H-2 是正）
--
-- 背景: 本テーブルは LINE 専用として作られ（channel の CHECK が ('line') のみ・
-- rpc_consume_user_link_code が 'line' 固定で INSERT）、Slack の紐づけ（秘書への DM に
-- TA- コードを送る）が追加された結果、Slack の行が channel='line' で作られてしまう。
-- CHECK には引っかからないため静かに嘘のデータが積もる。
--
-- 是正:
--   1) CHECK を channel_accounts.channel と同じ集合に広げる
--   2) rpc_consume_user_link_code は channel を「口座（channel_accounts）から導出」する
--      （呼び出し側が渡す値を信じない・口座が無ければ invalid）
--   3) 既存行を口座の channel でバックフィル（現状は全て LINE 口座なので実質無変更）
-- =============================================================================

alter table public.channel_user_links drop constraint if exists channel_user_links_channel_check;
alter table public.channel_user_links
  add constraint channel_user_links_channel_check
  check (channel in ('line', 'slack', 'discord', 'chatwork', 'google_chat', 'teams', 'telegram', 'whatsapp', 'messenger'));

update public.channel_user_links l
   set channel = ca.channel
  from public.channel_accounts ca
 where ca.id = l.channel_account_id
   and l.channel <> ca.channel;

comment on table public.channel_user_links is
  '内部ユーザー(auth.users) と チャット側ユーザーID（LINE userId / Slack user id 等）の本人紐付け。channel は口座(channel_accounts)から導出。channel_identities（顧問先の窓口）とは別軸。承認の本人性の土台だが、これ単体は認可の十分条件ではない（承認時に在籍を再検証する）。1人が複数チャネルにつなぐことは可（一意性は org×口座×user）。宛先の選び方は src/lib/channels/store.ts pickPreferredUserLink が正本';

-- 本体は 20260715070647_channel_user_links.sql と同一。差分は channel の導出（v_channel）のみ。
create or replace function public.rpc_consume_user_link_code(
  p_code_hash text,
  p_channel_account_id uuid,
  p_external_user_id text
)
returns table (status text, link_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fail_count int;
  v_code       public.channel_user_link_codes%rowtype;
  v_channel    text;
  v_consumed   uuid;
  v_link       uuid;
  v_conflict   boolean := false;
  v_result     text;
begin
  -- 直列化。これが無いと同時リクエストが全員「5回未満」を観測してロックを突破する
  perform pg_advisory_xact_lock(
    hashtext(p_channel_account_id::text || ':' || p_external_user_id)
  );

  -- 試行制限: 直近10分の失敗が5回以上ならロック。
  -- ここでは試行行を *追加しない*（追加すると窓が延長され、永久にロックが解けない）。
  select count(*) into v_fail_count
  from public.channel_user_link_attempts
  where channel_account_id = p_channel_account_id
    and external_user_id = p_external_user_id
    and not succeeded
    and attempted_at > now() - interval '10 minutes';

  if v_fail_count >= 5 then
    return query select 'locked'::text, null::uuid;
    return;
  end if;

  -- channel は口座から導出する（呼び出し側の値は信じない）。口座が無ければコード不正と同じ扱い
  select ca.channel into v_channel
  from public.channel_accounts ca
  where ca.id = p_channel_account_id;

  -- コードの状態を先に読み、invalid と expired を区別する
  select * into v_code
  from public.channel_user_link_codes
  where code_hash = p_code_hash
  limit 1;

  if v_channel is null
     or not found
     or v_code.used_at is not null
     -- 他口座・他orgのコードは成立させない（束縛検証）
     or v_code.channel_account_id <> p_channel_account_id
  then
    insert into public.channel_user_link_attempts (channel_account_id, external_user_id, succeeded)
    values (p_channel_account_id, p_external_user_id, false);
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if v_code.expires_at <= now() then
    insert into public.channel_user_link_attempts (channel_account_id, external_user_id, succeeded)
    values (p_channel_account_id, p_external_user_id, false);
    return query select 'expired'::text, null::uuid;
    return;
  end if;

  -- 消費とリンク作成を1つのセーブポイント（暗黙）に閉じ込める。
  -- 一意制約違反（そのチャットIDが既に別ユーザーに紐付いている）ならブロックごと巻き戻り、
  -- *コードの消費も取り消される*（正当な本人があとで使えるようコードを無駄にしない）。
  begin
    update public.channel_user_link_codes
       set used_at = now()
     where id = v_code.id
       and used_at is null
       and expires_at > now()
    returning id into v_consumed;

    if v_consumed is not null then
      insert into public.channel_user_links
        (org_id, user_id, channel, channel_account_id, external_user_id, linked_via)
      values
        (v_code.org_id, v_code.user_id, v_channel, p_channel_account_id, p_external_user_id, 'code')
      returning id into v_link;
    end if;
  exception
    when unique_violation then
      -- DBの変更は巻き戻るが、plpgsql の変数は巻き戻らないので明示的に戻す
      v_conflict := true;
      v_consumed := null;
      v_link := null;
  end;

  if v_conflict then
    v_result := 'conflict';
  elsif v_consumed is null then
    -- CAS で0行 = 同時実行に負けた（誰かが先に消費した）
    v_result := 'invalid';
  else
    v_result := 'ok';
  end if;

  -- 試行履歴はセーブポイントの外なので、conflict でも残る
  insert into public.channel_user_link_attempts (channel_account_id, external_user_id, succeeded)
  values (p_channel_account_id, p_external_user_id, v_result = 'ok');

  return query select v_result, v_link;
end $$;

revoke all on function public.rpc_consume_user_link_code(text, uuid, text) from public, anon, authenticated;
grant execute on function public.rpc_consume_user_link_code(text, uuid, text) to service_role;

comment on function public.rpc_consume_user_link_code(text, uuid, text) is
  'ワンタイム紐付けコードを消費して channel_user_links を作る（channel は口座から導出）。例外を投げず status で返す（例外だと試行履歴がロールバックされ総当たり対策が壊れる）。status: ok|invalid|expired|locked|conflict';
