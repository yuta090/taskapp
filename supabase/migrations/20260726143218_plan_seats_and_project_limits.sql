-- 課金の物差しを2軸に揃える（2026-07-26 決定・案A）
--
-- 背景: 数量上限が2系統に分かれている。
--   - DB: plans テーブル（projects_limit / members_limit / clients_limit）
--         → rpc_check_org_limits 経由で **招待の作成・受諾で実際に執行されている**
--   - TS: src/lib/billing/entitlements.ts の PLAN_LIMITS（LINEグループ・送信クォータ・プロジェクト数）
-- 数値が食い違うと「画面は30名と言うのにDBは20名で断る」といった静かな乖離が起きるため、
-- ここで plans の値を TS 側 PLAN_LIMITS と一致させる。一致は
-- src/__tests__/lib/billing/planLimitsParity.test.ts が回帰で固定する（片方だけ変えると落ちる）。
--
-- 方針:
--   - 内部メンバー(members): プランを上げると増える階段にする。free 5 / pro 20→**30**。
--     最上位(pro)の枠を超えた分は将来「1人あたりの追加料金」で伸ばす（席課金は別PR・金額未定）。
--   - 相手先ユーザー(clients): **無制限**にする（5/20 → NULL）。相手を招くほど費用が増える形は
--     この製品の価値（相手と一緒に使う）を殺す。相手先側の量は「接続グループ数」で既に有界。
--   - プロジェクト(projects): free 5→**3** / pro 20→**30**。タスク管理単体で使う層（開発会社等）の
--     規模に比例させる第2の物差し。※plans.projects_limit は現状どの作成経路からも参照されておらず、
--     実際の執行はアプリ側 (orgProjectCapacity) が行う。ここは表示(/api/billing/limits)と将来の
--     DB側執行のために値を揃えるもの。
--
-- ⚠ free.projects_limit は 5→3 と**絞る**変更。既存orgが上限超過になり得るが、執行は
--    「新規作成の拒否」のみで既存プロジェクトは一切止めない/隠さない（作成境界のみ）。

-- PARITY-MARKER: 下の3行の数値は PLAN_LIMITS と一致していること（planLimitsParity.test.ts が検証）
update plans set projects_limit = 3,    members_limit = 5,    clients_limit = null where id = 'free';
update plans set projects_limit = 30,   members_limit = 30,   clients_limit = null where id = 'pro';
update plans set projects_limit = null, members_limit = null, clients_limit = null where id = 'enterprise';
