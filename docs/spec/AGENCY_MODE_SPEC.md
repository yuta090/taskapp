# Agency Mode Specification

> **Version**: 0.2 (Draft)
> **Created**: 2026-03-07
> **Updated**: 2026-03-07
> **Status**: Design Phase

## 0. Iron Rule (絶対原則)

**Agency Mode はオプション機能である。代理店がいなくても、従来の「クライアント ↔ 開発者」の2者間ワークフローは一切変わらない。**

- `agency_mode = false`（デフォルト）のスペースでは、既存の `ball = 'client' | 'internal'` がそのまま動く
- ベンダーポータル、マージン管理、3者間ボールは `agency_mode = true` のスペースでのみ有効
- 既存のクライアントポータル、ボール管理、レビュー/承認、会議管理、日程調整は一切影響を受けない
- DB マイグレーションは追加のみ（既存カラム・制約の破壊的変更なし）
- `rpc_pass_ball` は既存シグネチャを維持。`rpc_pass_ball_v2` を新設
- 既存テストは全て通り続ける

**この原則に違反する設計変更は却下する。**

---

## 1. Overview

### 1.1 Purpose

代理店（Web制作代理店、広告代理店、SIer元請け等）が TaskApp を使って「エンドクライアント」と「制作会社/フリーランス（ベンダー）」の間に立ち、3者間のプロジェクト管理を行うための機能セット。

### 1.2 Business Rationale

- **1代理店の導入 = 複数組織への波及**: 代理店1社 → 制作会社N社 + エンドクライアントM社
- **競合にない機能**: Backlog/Jira/Asana に「代理店モード」（情報の段階的開示 + マージン管理）は存在しない
- **高単価プラン誘導**: Agency プランは Business 以上の価格設定が可能

### 1.3 Core Concept

```
エンドクライアント（発注元）
    | クライアントポータル（売値のみ、マイルストーン、承認）
代理店 = TaskApp 組織オーナー（フルアクセス）
    | ベンダーポータル（原価、詳細タスク、技術仕様）
制作会社/フリーランス（下請け）
```

代理店が **一番多く見える**。代理店はポータル利用者ではなく、管理画面そのものを使う。

### 1.4 Visibility Matrix

| 情報 | エンドクライアント | 代理店 | 制作会社 |
|------|:---:|:---:|:---:|
| マイルストーン進捗 | o | o | o |
| 詳細タスク一覧 | x | o | o |
| 原価（工数 x 原価単価） | x | o | o |
| 売値（マージン込み） | o | o | x |
| マージン率・金額 | x | o | x |
| 技術仕様・GitHubリンク | x | o | o |
| 議事録 | delta | o | o |
| 監査ログ | x | o | x |
| ボール状態 | 自分側のみ | 全方向 | 自分側のみ |

`delta`: クライアント向けにフィルタされた内容のみ（既存仕様通り）

---

## 2. Data Model Changes

### 2.1 BallSide 拡張

```sql
-- 現状
ball = 'client' | 'internal'

-- 拡張
ball = 'client' | 'agency' | 'vendor'
```

| 値 | 意味 | 対応するポータル |
|---|---|---|
| `client` | エンドクライアントが次に動く | クライアントポータルに表示 |
| `agency` | 代理店が次に動く | 管理画面に表示 |
| `vendor` | 制作会社が次に動く | ベンダーポータルに表示 |

**後方互換性**: `'internal'` は `'agency'` のエイリアスとして維持。既存データのマイグレーションで `internal` → `agency` に変換。非代理店モードのスペースでは従来通り `client/internal` のみ使用。

```sql
-- DDL v0.9
ALTER TABLE tasks
  DROP CONSTRAINT tasks_ball_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_ball_check
  CHECK (ball IN ('client', 'internal', 'agency', 'vendor'));

-- 既存データは変更不要（internal のまま動作）
-- agency_mode=true のスペースでのみ agency/vendor が有効
```

### 2.2 SpaceRole 拡張

```sql
-- 現状
SpaceRole = 'admin' | 'editor' | 'viewer' | 'client'

-- 拡張
SpaceRole = 'admin' | 'editor' | 'viewer' | 'client' | 'vendor'
```

| ロール | 管理画面 | クライアントポータル | ベンダーポータル |
|---|:---:|:---:|:---:|
| admin | o | - | - |
| editor | o | - | - |
| viewer | o (閲覧のみ) | - | - |
| client | x | o | x |
| vendor | x | x | o |

### 2.3 スペース設定拡張

```sql
-- spaces テーブルに追加
ALTER TABLE spaces ADD COLUMN agency_mode boolean NOT NULL DEFAULT false;
ALTER TABLE spaces ADD COLUMN default_margin_rate numeric(5,2) DEFAULT NULL;
  -- CHECK (default_margin_rate >= 0 AND default_margin_rate <= 999.99)
```

`agency_mode = true` のスペースでのみ:
- `ball` に `'agency'` / `'vendor'` が使用可能
- ベンダーポータルが有効
- マージン管理UIが表示

### 2.4 見積もり・マージンテーブル（新規）

```sql
CREATE TABLE task_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  space_id uuid NOT NULL REFERENCES spaces(id),
  task_id uuid NOT NULL REFERENCES tasks(id),

  -- 原価（制作会社の見積もり）
  cost_hours numeric(8,2) DEFAULT NULL,       -- 工数（時間）
  cost_unit_price numeric(12,2) DEFAULT NULL,  -- 原価単価（円/時間）
  cost_total numeric(14,2) GENERATED ALWAYS AS (cost_hours * cost_unit_price) STORED,

  -- 売値（エンドクライアントへの提示額）
  sell_mode text NOT NULL DEFAULT 'margin',
    -- 'margin': cost_total * (1 + margin_rate) で自動計算
    -- 'fixed':  sell_total を直接指定
  margin_rate numeric(5,2) DEFAULT NULL,       -- マージン率（%）
  sell_total numeric(14,2) DEFAULT NULL,       -- 売値合計（円）
    -- margin モードでは GENERATED、fixed モードでは手動入力

  -- 承認状態
  vendor_submitted_at timestamptz DEFAULT NULL,  -- 制作会社が見積もり提出
  agency_approved_at timestamptz DEFAULT NULL,   -- 代理店が原価承認
  client_approved_at timestamptz DEFAULT NULL,   -- エンドクライアントが売値承認

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(task_id)
);

-- RLS
ALTER TABLE task_pricing ENABLE ROW LEVEL SECURITY;

-- 代理店スタッフ: 全カラム参照可
CREATE POLICY "agency_full_access" ON task_pricing
  FOR ALL USING (
    org_id IN (SELECT org_id FROM org_memberships WHERE user_id = auth.uid())
  );

-- クライアント: sell_total のみ参照可（原価・マージン率は非表示）
-- → ポータルAPI側で sell_total のみ返却（RLS + API層の二重防御）

-- ベンダー: cost 系のみ参照可（sell_total・margin_rate は非表示）
-- → ベンダーポータルAPI側で cost 系のみ返却
```

### 2.5 InviteRole 拡張

```sql
-- 現状
InviteRole = 'client' | 'member'

-- 拡張
InviteRole = 'client' | 'member' | 'vendor'
```

### 2.6 ボールラベル拡張

```typescript
// src/lib/labels.ts 拡張
const BALL_LABELS_AGENCY = {
  'client': 'クライアント',
  'agency': '代理店',     // 自社（管理画面表示時は「自社」）
  'vendor': '制作会社',
}

const BALL_STATUS_LABELS_AGENCY = {
  'client': 'クライアント確認待ち',
  'agency': '代理店対応中',
  'vendor': '制作会社対応中',
}
```

---

## 3. Vendor Portal

### 3.1 URL Structure

```
/vendor-portal/:token
```

クライアントポータル (`/portal/:token`) と対称的な構造。

### 3.2 表示内容

| 項目 | 表示 | 備考 |
|---|:---:|---|
| タスク一覧 | o | `client_scope='deliverable'` + `client_scope='internal'` 両方 |
| タスク詳細 | o | description, subtasks, comments(visibility='internal') |
| 原価（工数 x 単価） | o | task_pricing.cost_* |
| 売値 | x | 絶対に非表示 |
| マージン率 | x | 絶対に非表示 |
| マイルストーン | o | |
| ガントチャート | o | |
| GitHub PR リンク | o | |
| 技術仕様 (Wiki) | o | |
| 日程調整 | o | 回答可能 |
| ボール状態 | o | 自社（vendor）と代理店（agency）のみ。client の存在は「依頼元」と表示 |
| 会議・議事録 | o | 参加会議のみ |
| 承認アクション | o | 見積もり提出、納品物チェック |
| 監査ログ | x | |

### 3.3 ベンダーポータル専用アクション

| アクション | 説明 |
|---|---|
| **見積もり提出** | 工数・単価を入力 → `vendor_submitted_at` を記録 → 代理店に通知 |
| **進捗更新** | タスクステータス変更（backlog→in_progress→done） |
| **質問・確認依頼** | コメント投稿（visibility='internal'）→ 代理店に通知 |
| **納品物提出** | タスクを `in_review` にする → 代理店にレビュー依頼 |
| **日程回答** | 日程提案への回答 |

### 3.4 ベンダーポータル非表示情報

- エンドクライアントの社名・連絡先（代理店設定で開示/非開示を選択可能）
- 売値、マージン率
- 他のベンダーのタスク（同一スペースに複数ベンダーがいる場合、自社分のみ表示）
- 代理店の社内コメント（visibility='agency_only' — 新規追加）

---

## 4. 3-Way Ball

### 4.1 rpc_pass_ball 拡張

```sql
-- 現行シグネチャ
rpc_pass_ball(
  p_task_id uuid,
  p_ball text,              -- 'client' | 'internal'
  p_client_owner_ids uuid[],
  p_internal_owner_ids uuid[],
  p_reason text DEFAULT NULL,
  p_meeting_id uuid DEFAULT NULL
)

-- 拡張シグネチャ
rpc_pass_ball_v2(
  p_task_id uuid,
  p_ball text,              -- 'client' | 'agency' | 'vendor'
  p_client_owner_ids uuid[] DEFAULT '{}',
  p_agency_owner_ids uuid[] DEFAULT '{}',
  p_vendor_owner_ids uuid[] DEFAULT '{}',
  p_reason text DEFAULT NULL,
  p_meeting_id uuid DEFAULT NULL
)
```

### 4.2 task_owners 拡張

```sql
-- 現状
side = 'client' | 'internal'

-- 拡張
ALTER TABLE task_owners
  DROP CONSTRAINT task_owners_side_check;

ALTER TABLE task_owners
  ADD CONSTRAINT task_owners_side_check
  CHECK (side IN ('client', 'internal', 'agency', 'vendor'));
```

### 4.3 ボール遷移パターン

代理店モードでの典型的なフロー:

```
1. タスク作成（代理店）
   ball: agency → vendor    「制作お願いします」

2. 見積もり提出（制作会社）
   ball: vendor → agency    「見積もりできました」

3. マージン設定 + クライアント提示（代理店）
   ball: agency → client    「ご確認ください」

4. 承認（クライアント）
   ball: client → agency    「承認しました」

5. 作業指示（代理店）
   ball: agency → vendor    「承認取れました、着手してください」

6. 納品（制作会社）
   ball: vendor → agency    「完了しました」

7. 検収 + クライアント報告（代理店）
   ball: agency → client    「納品物をご確認ください」
```

### 4.4 ダッシュボード表示

代理店の管理画面では、ボールを3方向で集計:

```
+----------------------------------+
| 全案件ボール状況                   |
+----------+------+-------+--------+
|          | 自社  | Client | Vendor |
+----------+------+-------+--------+
| A社LP    |  1   |   2   |   3    |
| B社EC    |  0   |   1   |   5    |
| C社アプリ |  3   |   0   |   2    |
+----------+------+-------+--------+
| 合計     |  4   |   3   |   10   |
+----------+------+-------+--------+
```

---

## 5. Margin Management

### 5.1 マージン設定フロー

```
制作会社が原価入力（ベンダーポータル）
  ↓
代理店が確認・マージン率設定（管理画面）
  ↓
売値が自動計算
  ↓
クライアントポータルに売値のみ表示
  ↓
クライアントが承認
```

### 5.2 マージン設定UI（管理画面 TaskInspector 拡張）

```
+-- 価格設定 -------------------------+
| 原価                                |
|   工数: [40] h × 単価: [¥5,000]     |
|   原価合計: ¥200,000               |
|                                     |
| マージン                             |
|   [o] マージン率  [ ] 固定売値       |
|   マージン率: [40] %                 |
|   売値合計: ¥280,000               |
|   利益: ¥80,000                    |
|                                     |
| [クライアントに提示する]              |
+-------------------------------------+
```

### 5.3 マイルストーン集計

```
+-- マイルストーン: Phase 1 設計 ------+
| タスク数: 8                          |
| 原価合計: ¥800,000                  |
| 売値合計: ¥1,120,000               |
| 利益合計: ¥320,000 (40%)           |
|                                     |
| クライアント承認: 5/8 タスク承認済み   |
+-------------------------------------+
```

### 5.4 スペースデフォルトマージン

```
設定 > スペース > 代理店設定
  デフォルトマージン率: [35] %
  ※ タスク個別に上書き可能
```

---

## 6. Report Generation (3 Types)

### 6.1 クライアント向けレポート

```markdown
# 週次進捗レポート — A社 ECサイトリニューアル

## 今週の進捗
- デザイン制作: 完了
- フロントエンド実装: 60% → 85%

## 来週の予定
- フロントエンド実装完了
- テスト開始

## ご確認いただきたい事項
- 商品ページデザイン最終確認（ポータルから確認可能）

## 費用
- 追加見積もり: ¥120,000（承認待ち）
```

**特徴**: 売値ベース、マイルストーン粒度、技術用語なし

### 6.2 上司/経営向けレポート

```markdown
# 全案件サマリー — 2026年3月第1週

| 案件 | 進捗 | 原価累計 | 売上累計 | 利益率 | リスク |
|------|------|---------|---------|--------|--------|
| A社LP | 85% | ¥640K | ¥896K | 40% | - |
| B社EC | 45% | ¥1.2M | ¥1.68M | 40% | 制作遅延 |
| C社アプリ | 15% | ¥200K | ¥300K | 33% | 仕様未確定 |

## 要注意案件
- B社EC: 制作Dのフロントエンド実装が3日遅延中（ball: vendor）

## 今週の売上確定
- A社: ¥280,000（Phase 2 承認済み）
```

**特徴**: 全案件横串、利益率表示、リスクフラグ

### 6.3 制作会社向けレポート

```markdown
# 作業指示 — 来週分

## 継続タスク
- [ ] フロントエンド: Settings画面 (残 8h)
- [ ] 結合テスト環境構築 (4h)

## 新規タスク
- [ ] 商品詳細ページ実装 (12h, 3/15 期限)

## 確認事項
- デザインFigmaリンク: (URL)
- API仕様: (URL)
```

**特徴**: 原価ベース、技術詳細あり、売値なし

---

## 7. Phase Plan

### Phase 1: 基盤 + ベンダーポータル (MVP)

| 項目 | 内容 |
|---|---|
| **DB** | `agency_mode` フラグ、`vendor` ロール追加、`task_pricing` テーブル |
| **ベンダーポータル** | `/vendor-portal/:token` — タスク閲覧、進捗更新、見積もり提出 |
| **マージン管理** | TaskInspector に価格設定パネル追加 |
| **招待** | `role='vendor'` の招待フロー |
| **表示制御** | クライアントポータルに売値のみ表示、ベンダーポータルに原価のみ表示 |

**ゴール**: 代理店が「制作会社に作業を出して、マージンを乗せてクライアントに見せる」最小フローが動く

### Phase 2: 3者間ボール + 通知

| 項目 | 内容 |
|---|---|
| **ボール拡張** | `ball = 'client' \| 'agency' \| 'vendor'`、`rpc_pass_ball_v2` |
| **ラベル** | 3者間ラベル表示（管理画面/各ポータル） |
| **通知** | ボール移動時に適切なポータルに通知配信 |
| **Slack** | ベンダー用チャンネルへの通知連携 |
| **ダッシュボード** | 3方向ボール集計ビュー |

**ゴール**: 「誰が止めているか」が3方向で可視化される

### Phase 3: レポート + 横串管理

| 項目 | 内容 |
|---|---|
| **レポート3種** | クライアント向け/上司向け/制作向けの自動生成 |
| **横串ダッシュボード** | 全案件 x 全クライアント x 全ベンダーのサマリー |
| **利益率管理** | マイルストーン/スペース単位の利益集計 |
| **ホワイトラベル** | ロゴ差し替え、カスタムカラー |

**ゴール**: 代理店の経営管理ツールとして機能する

### Phase 4: 高度な機能

| 項目 | 内容 |
|---|---|
| **複数ベンダー** | 1スペースに複数制作会社、タスクごとにベンダー割当 |
| **ベンダー間情報遮断** | ベンダーAはベンダーBのタスクを見られない |
| **テンプレート** | 代理店向けプリセット（Web制作代理店、広告代理店等） |
| **請求書生成** | 売値ベースの請求書PDF自動生成 |
| **API** | ベンダー向けMCPツール（制作会社もCLIからタスク操作） |

---

## 8. Pricing Impact

### 新プラン案

| プラン | 対象 | 月額（税抜） | 主要制限 |
|---|---|---|---|
| Starter | 個人・学習 | ¥0 | 1スペース、ベンダーポータルなし |
| Freelance | フリーランス | ¥1,980 | 3スペース、ベンダーポータルなし |
| Business | チーム | ¥4,980/人 | 無制限スペース、ベンダーポータルなし |
| **Agency** | **代理店** | **¥9,800/人** | **無制限スペース、ベンダーポータル、マージン管理、横串ダッシュボード、ホワイトラベル** |

### Agency プランの差別化機能

- `agency_mode` 有効化
- ベンダーポータル（招待数無制限）
- マージン管理（原価/売値分離）
- 3者間ボール
- レポート3種自動生成
- 横串ダッシュボード
- ホワイトラベル（ロゴ + CNAME）
- 優先サポート

---

## 9. Migration & Backward Compatibility

### 9.1 既存データへの影響

- `ball='internal'` は引き続き有効（`agency_mode=false` のスペースではそのまま使用）
- `agency_mode=true` のスペースでは `'internal'` を `'agency'` として表示
- DB上は `'internal'` を残し、表示層で変換（破壊的マイグレーション不要）

### 9.2 API 後方互換

- `rpc_pass_ball` は既存シグネチャを維持（`'client' | 'internal'` のみ受付）
- `rpc_pass_ball_v2` を新設（`'client' | 'agency' | 'vendor'` 対応）
- MCP ツールの `ball_pass` も v2 対応版を追加

### 9.3 RLS ポリシー

- `vendor` ロールのユーザーには `client_scope='deliverable'` + `client_scope='internal'` の両方を表示
- ただし `task_pricing` の `sell_total`, `margin_rate` カラムは RLS で遮断
- クライアント向け RLS は既存のまま（`client_scope='deliverable'` のみ）

---

## 10. Comment Visibility Extension

### 10.1 現状

```sql
visibility = 'client' | 'internal'
```

### 10.2 拡張

```sql
visibility = 'client' | 'internal' | 'vendor' | 'agency_only'
```

| visibility | クライアント | 代理店 | ベンダー |
|---|:---:|:---:|:---:|
| `client` | o | o | o |
| `internal` | x | o | o |
| `vendor` | x | o | o |
| `agency_only` | x | o | x |

`agency_only`: 代理店の社内メモ。制作会社にもクライアントにも見えない。

---

## 11. Design Decisions (確定事項)

| # | 項目 | 決定 | 備考 |
|---|---|---|---|
| 1 | **エンドクライアント情報の開示** | **スペース設定でトグル** | デフォルト非開示。代理店が案件ごとに選択 |
| 2 | **ベンダーからクライアントへの直接連絡** | **スペース設定でトグル** | デフォルト不可。代理店が許可した場合のみベンダーが `visibility='client'` コメント投稿可能 |
| 3 | **ベンダーからのサブタスク作成** | **可能** | 既存の `parent_task_id` を活用。ベンダーは自分に割り当てられたタスクの配下にサブタスク作成可能 |
| 4 | **ポータル表示項目の選択制御** | **制御可能** | スペース設定でクライアントポータルの表示項目をトグル（ガント/バーンダウン/Wiki/マイルストーン詳細） |

### 11.1 ポータル表示制御の設計

```sql
-- spaces テーブルに追加（agency_mode に関係なく全スペースで有効）
ALTER TABLE spaces ADD COLUMN portal_visible_sections jsonb
  NOT NULL DEFAULT '{"gantt": true, "burndown": true, "wiki": false, "milestone_detail": true}';
```

クライアントポータルで表示する項目をスペース単位で制御:

| 項目 | デフォルト | 説明 |
|---|---|---|
| `gantt` | true | ガントチャート表示 |
| `burndown` | true | バーンダウンチャート表示 |
| `wiki` | false | Wiki ページ表示 |
| `milestone_detail` | true | マイルストーン内のタスク詳細表示（false ならマイルストーン名と進捗率のみ） |

**注**: この機能は agency_mode でないスペースでも有効。通常のクライアントポータルでも表示項目を選べる。

### 11.2 ベンダーポータル設定

```sql
-- agency_mode=true のスペースでのみ有効
ALTER TABLE spaces ADD COLUMN vendor_settings jsonb
  NOT NULL DEFAULT '{"show_client_name": false, "allow_client_comments": false}';
```

| 項目 | デフォルト | 説明 |
|---|---|---|
| `show_client_name` | false | ベンダーにエンドクライアントの社名を表示 |
| `allow_client_comments` | false | ベンダーが `visibility='client'` のコメントを投稿可能にする |

## 12. Open Questions (残課題)

1. **複数代理店**: 1つのエンドクライアント案件に複数の代理店が関わるケース → Phase 4 以降で検討
2. **原価の事後変更**: 制作会社が作業中に見積もりを変更した場合のフロー → 変更通知 + 代理店承認

---

## 13. LP Messaging for Agency

### セクション案: 「代理店の中継業務を、ゼロにする。」

```
見出し:
  制作会社の報告を翻訳して、クライアントに伝え直す。
  その作業、もう要りません。

サブ:
  制作会社には原価ベースのタスク管理を。
  クライアントにはマージン込みの進捗共有を。
  あなたは、両方を見渡すだけ。

3カード:
  1. 「見積もりの中継をゼロに」
     制作会社が原価を入力 → マージン自動適用 → クライアントに売値で提示

  2. 「報告書の翻訳をゼロに」
     制作向け・クライアント向け・上司向けのレポートを自動生成

  3. 「"誰が止めてる？"をゼロに」
     クライアント・代理店・制作の3者間でボールを可視化
```

---

## Appendix A: Use Case Scenarios

### A.1 Web制作代理店

```
代理店: 株式会社メディアプランニング（5名）
クライアント: A社（コーポレートサイトリニューアル）
制作会社: デザインスタジオB（フリーランス2名）

1. 代理店PMがA社からヒアリング → TaskAppでスペース作成（agency_mode=true）
2. 制作Bをベンダーとして招待
3. 制作BがタスクにDB原価を入力（デザイン 30h x ¥4,000 = ¥120,000）
4. 代理店PMがマージン50%を設定 → 売値 ¥180,000
5. A社のクライアントポータルに ¥180,000 で表示 → ワンクリック承認
6. 制作Bがベンダーポータルから進捗更新
7. 代理店PMは管理画面で両方を監視
8. 週次: A社向けレポート（売値ベース）+ 上司向けレポート（利益率入り）が自動生成
```

### A.2 SIer元請け

```
元請け: 株式会社システムソリューション（20名）
エンドクライアント: C銀行（基幹システム改修）
下請け: D社（バックエンド）、E社（フロントエンド）

1. 元請けPMがスペース作成 → D社、E社をベンダー招待
2. D社のタスクとE社のタスクは互いに見えない（Phase 4: ベンダー間情報遮断）
3. 3者間ボール: C銀行待ち（仕様確認）/ 元請け待ち（承認）/ D社待ち（実装）
4. 監査ログ: 「誰がいつ何を決定したか」がC銀行向け報告書に使える
5. マイルストーンベースの進捗をC銀行ポータルに公開
```

### A.3 広告代理店

```
代理店: 株式会社アドクリエイト（10名）
クライアント: F社（新商品LP制作）
制作: フリーランスデザイナーG、コーダーH

1. LP制作プリセットでスペース作成
2. デザイナーGとコーダーHを別々にベンダー招待
3. G→代理店→F社の承認フロー（デザイン確認）
4. 承認後、代理店→Hに実装指示（ball: agency → vendor）
5. マージン管理: G ¥150K + H ¥100K = 原価 ¥250K → 売値 ¥400K
```
