-- =============================================================================
-- fix(security): 申し送りの redaction を、昇格先の本体タスクにも波及させる
--                ＋ 既存の redaction バグ（1メッセージ→複数申し送りで失敗）を修正する
--
-- 顧問先の発言を redact（機微情報削除）すると、元メッセージ・申し送り
-- (channel_digest_tasks) は匿名化される（20260711121910_integration_sinks.sql）。
-- しかし Stage 2.7-B（20260715074403_digest_task_promotion.sql）で申し送りが本体 tasks に
-- 昇格できるようになった結果、**昇格先タスクには機微情報がコピーされたまま残る穴**ができた。
--
-- 例: 「A社の申告漏れ○○万円を修正」という発言 → 申し送り → タスク化 → 発言をredact
--     しても、tasks.title/description に元の機微文が残り、内部メンバーに見え続ける。
--
-- ★さらに、既存 redact には潜在バグがあった:
--   1メッセージから複数の申し送り（unique は (source_message_id, title)）を作れる。
--   redact は全digestの title を一律 '[削除済み]' に書き換えるため、2件目で
--   unique(source_message_id, title) 違反 → **redaction 全体がロールバックし機微が消せない**。
--   （本番でも再現。セキュリティ機能が特定条件で無効になる欠陥）
--   → 匿名化タイトルを行ごとに一意化（'[削除済み]' + 行id）して衝突を避ける。
--     人間には同じに見えるので証跡破壊の意図は保たれる。
--
-- 対策（本ファイル）:
--   1. 昇格先タスクの匿名化を追加（promoted_task_id を辿る・source_message_id 単位・status不問）
--   2. digest 匿名化を id 一意化して unique 衝突を解消
--
-- 最新定義（20260711121910_integration_sinks.sql）を土台に同一シグネチャで create or replace。
-- security definer / search_path / service_role 限定 grant は保持する。
-- =============================================================================

create or replace function public.rpc_redact_channel_message(
  p_message_id uuid,
  p_redacted_by uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update channel_messages
  set body = '[削除済み（機微情報）]',
      payload = '{}'::jsonb,
      storage_path = null,
      redacted_at = now(),
      redacted_by = p_redacted_by,
      redacted_reason = p_reason
  where id = p_message_id
    and redacted_at is null;

  get diagnostics v_updated = row_count;

  if v_updated > 0 then
    -- ロックの張り合いはデッドロック検出で即 40P01 になる。無用な待ちで詰まらせないよう上限を置く。
    set local lock_timeout = '5s';

    -- ────────────────────────────────────────────────────────────────────────
    -- 【既知の限界】タスク削除との間に、原理的に解消できないデッドロック経路がある。
    --   redact は「digest FOR UPDATE → tasks UPDATE」の順（下記）。
    --   tasks の DELETE は promoted_task_id の ON DELETE SET NULL により
    --   「task ロック → digest UPDATE」の順になる。順序が逆で循環し得る。
    --
    --   これは解消できない: promote RPC と直列化するには digest を先にロックする必要があり
    --   （promote は digest ロック下で promoted_task_id を書く）、delete と直列化するには
    --   task を先にロックする必要がある。両立しない。2.7-B の ON DELETE SET NULL に内在する。
    --
    --   ただし **どちらが勝っても最終状態は安全**:
    --     delete 勝ち: task は消滅（漏洩なし）、digest.promoted_task_id は NULL に。redact 再実行で無害。
    --     redact 勝ち: task を匿名化 → その後 delete が消す。
    --   よって害は一過性の失敗のみ。**この関数を UI/API に配線する際は、呼び出し側で
    --   deadlock_detected(40P01) と、下の lock_timeout が出す lock_not_available(55P03) の
    --   両方を検知して redact を再試行し、成功まで完了扱いにしないこと。**
    --   （現時点で redact はまだ配線されておらず、管理者が直接実行する段階）
    -- ────────────────────────────────────────────────────────────────────────
    --
    -- ★昇格RPC(20260715074403)と直列化するため、対象 digest 行を先に FOR UPDATE でロックする。
    --   昇格は「digestをFOR UPDATE → tasks INSERT → digest.promoted_task_id 書込み」の順。
    --   redact 側がこのロックを取らずに tasks を匿名化すると、昇格Txが未コミットで持つ
    --   promoted_task_id を見落とし、redact 成功後もタスクに機微が残る（Codexレビュー指摘）。
    --   id 昇順で決定的にロックし、昇格と奪い合って直列化する。
    perform 1 from channel_digest_tasks
    where source_message_id = p_message_id
    order by id
    for update;

    -- 昇格先の本体タスクを匿名化する（Stage 2.8 fix: redaction→task 連動）。
    -- status は問わない。完了済みタスクにも顧客の機微発言を残さない。
    -- org_id 一致も条件に加える（promoted_task_id のFKは task ID 単体のため、越境防御をJOINで持つ）。
    update tasks t
    set title = '[削除済み]',
        description = ''
    from channel_digest_tasks d
    where t.id = d.promoted_task_id
      and t.org_id = d.org_id
      and d.source_message_id = p_message_id
      and d.promoted_task_id is not null;

    -- digest を匿名化する。1メッセージから複数申し送りがあり得る（unique は
    -- (source_message_id, title)）ため、title を **行ごとに一意化** する。
    -- '[削除済み]' 一律だと2件目以降で unique 違反 → redaction 全体が失敗する既存バグになる。
    -- id 全体（PKなので確実に一意）を付ける。元の機微文は完全に消える。
    --
    -- prefix でのスキップはしない: 元の title が偶然 '[削除済み]' 始まりでも匿名化・dismiss する
    -- （この関数は redacted_at is null の初回にしか到達しないため、全対象行を処理してよい）。
    -- open/done → dismissed（statusが変わるのでenqueueトリガーが発火しtask.dismissedを配達）。
    update channel_digest_tasks
    set title = '[削除済み] ' || id::text,
        status = case when status <> 'dismissed' then 'dismissed' else status end
    where source_message_id = p_message_id;
  end if;

  return v_updated > 0;
end;
$$;

revoke execute on function public.rpc_redact_channel_message(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.rpc_redact_channel_message(uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 既存漏洩データの一回限りの是正（Codexレビュー指摘）
-- -----------------------------------------------------------------------------
-- このmigration適用前に redact 済みのメッセージについては、tasks 連動が無かったため
-- 昇格先タスクに機微が残っている。RPC は redacted_at is null の初回にしか到達せず
-- 再実行しても false を返すだけなので、ここで一回だけ遡って匿名化する。
-- 対象: 元メッセージが redact 済み（body が redaction マーカー）かつ digest が昇格済みのタスク。
update tasks t
set title = '[削除済み]',
    description = ''
from channel_digest_tasks d
join channel_messages m on m.id = d.source_message_id
where t.id = d.promoted_task_id
  and t.org_id = d.org_id
  and d.promoted_task_id is not null
  and m.redacted_at is not null
  and t.title <> '[削除済み]';   -- 既に匿名化済みは触らない（冪等・再適用安全）

-- =============================================================================
-- 巻き戻しについて（forward fix が標準手順）
--   タスク匿名化を外す = セキュリティ穴を再度開けることになる。戻さないこと。
-- =============================================================================
