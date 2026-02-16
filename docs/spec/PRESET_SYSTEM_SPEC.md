# プロジェクトプリセットシステム仕様

> **Version**: 1.1
> **Date**: 2026-02-19
> **Status**: 実装済み

---

## 概要

プロジェクト（Space）作成時にジャンル別プリセットを選択し、Wiki構成・マイルストーン・設定を一括セットアップする機能。

---

## ジャンル一覧

| Key | ラベル | Wiki | マイルストーン | ownerField |
|-----|--------|------|---------------|------------|
| `web_development` | Web/アプリ開発 | API仕様書, DB設計書, UI仕様書, インフラ構成図, ホーム | 要件定義→設計→開発→テスト→リリース | null |
| `system_development` | 業務システム開発 | 要件定義書, DB設計書, 画面一覧, テスト計画書, ホーム | 要件定義→基本設計→詳細設計→開発→テスト→運用開始 | null |
| `design` | デザイン制作 | デザインブリーフ, スタイルガイド, 成果物一覧, ホーム | ヒアリング→コンセプト→制作→修正→納品 | null |
| `consulting` | コンサルティング | 調査レポート, 提案資料, 議事録テンプレート, ホーム | 現状分析→課題整理→提案→実行支援→効果測定 | true |
| `marketing` | マーケティング | キャンペーン計画, KPI管理, コンテンツカレンダー, ホーム | 企画→制作→実施→分析→改善 | null |
| `event` | イベント企画 | 企画書, タイムライン, 備品・手配リスト, ホーム | 企画→準備→集客→当日運営→振り返り | true |
| `legal_accounting` | 士業 | 契約書チェックリスト, 確認事項一覧, 期日管理表, ホーム | 受任→調査→方針確定→書類作成→提出→完了 | true |
| `video_production` | 映像制作 | 企画書/構成表, 制作進行表, 納品仕様書, ホーム | 企画→撮影/制作→初稿→修正→納品 | null |
| `construction` | 建設・建築 | 設計概要, 仕様書, 変更履歴, 検査チェックリスト, ホーム | 設計→申請→着工→中間検査→竣工→引渡し | true |
| `blank` | 白紙から始める | なし | なし | null |

---

## DBスキーマ

### spaces.preset_genre

```sql
ALTER TABLE spaces ADD COLUMN preset_genre text NULL;
ALTER TABLE spaces ADD CONSTRAINT spaces_preset_genre_check
  CHECK (preset_genre IS NULL OR preset_genre IN (
    'web_development', 'system_development', 'design',
    'consulting', 'marketing', 'event',
    'legal_accounting', 'video_production', 'construction',
    'blank'
  ));
```

| 値 | 意味 | Wiki自動生成 |
|----|------|-------------|
| `NULL` | 旧来のspace（機能導入前） | する（後方互換） |
| `'blank'` | 明示的に白紙を選択 | しない |
| ジャンル名 | プリセット適用済み | しない |

### RPC: rpc_create_space_with_preset

SECURITY DEFINER関数。単一トランザクション内で以下を原子的に実行:

1. `auth.uid()` で認証チェック
2. `org_memberships` でメンバーシップチェック
3. `spaces` INSERT（preset_genre, owner_field_enabled含む）
4. `space_memberships` INSERT（creator = admin）
5. `milestones` 一括INSERT
6. `wiki_pages` 一括INSERT（spec pages → home page の順）

パラメータ:

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| p_org_id | uuid | — | 組織ID |
| p_name | text | — | プロジェクト名 |
| p_preset_genre | text | 'blank' | プリセットジャンル |
| p_milestones | jsonb | '[]' | `[{name, order_key}]` |
| p_wiki_pages | jsonb | '[]' | `[{title, body, tags, is_home}]` |
| p_owner_field_enabled | boolean | NULL | オーナーフィールド有効化 |

返却: `{ok, space_id, milestones_created, wiki_pages_created}`

---

## API

### POST /api/spaces/create-with-preset

詳細は `docs/api/API_SPEC_v0.4.md` セクション4.1を参照。

---

## プリセット定義（コードベース）

```
src/lib/presets/
  index.ts                    -- 型定義, レジストリ, getPreset(), getGenrePresets()
  genres/
    web-development.ts        -- Web/アプリ開発
    system-development.ts     -- 業務システム開発
    design.ts                 -- デザイン制作
    consulting.ts             -- コンサルティング
    marketing.ts              -- マーケティング
    event.ts                  -- イベント企画
    legal-accounting.ts       -- 士業（法律・会計・税理士）
    video-production.ts       -- 映像・コンテンツ制作
    construction.ts           -- 建設・建築・内装
```

### 型定義

```typescript
type PresetGenre = 'web_development' | 'system_development' | 'design'
  | 'consulting' | 'marketing' | 'event'
  | 'legal_accounting' | 'video_production' | 'construction'
  | 'blank'

interface PresetDefinition {
  genre: PresetGenre
  label: string
  description: string
  icon: string              // Phosphor icon name
  wikiPages: PresetWikiPage[]
  milestones: PresetMilestone[]
  recommendedIntegrations: string[]
  defaultSettings: { ownerFieldEnabled: boolean | null }
}
```

---

## UI

### SpaceCreateSheet

- ファイル: `src/components/space/SpaceCreateSheet.tsx`
- エントリポイント: LeftNav「チーム」セクション横「+」ボタン
- 2ステップbottom-sheet（Step1: ジャンル選択 → Step2: 名前入力+確認）
- 詳細は `docs/spec/UI_RULES_AND_SCREENS.md` セクションEを参照

---

## 後方互換

### useWikiPages.ts の条件ガード

既存の wiki 自動生成ロジックに `preset_genre` ガードを追加:

- `preset_genre = NULL`（旧space）→ 従来通り自動生成（SPEC_TEMPLATES使用）
- `preset_genre != NULL`（preset適用済み or blank）→ 自動生成スキップ
- チェック失敗時 → fail-closed（自動生成をスキップ）

既存の `src/lib/wiki/defaultTemplate.ts` は変更なし（後方互換で残存）。
