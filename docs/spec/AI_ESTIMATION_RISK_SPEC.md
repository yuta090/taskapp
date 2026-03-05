# AI見積もり支援 & リスク予測 仕様書

> **Version**: 1.0
> **Last Updated**: 2026-03-05
> **Status**: 実装済み

## 概要

AI/ルールベースで工数見積もりを支援し、マイルストーンの完了リスクを予測する。

## 1. AI設定管理

### データモデル

`org_ai_config` テーブル:

| カラム | 型 | 説明 |
|--------|-----|------|
| `id` | uuid | PK |
| `org_id` | uuid | 組織ID |
| `provider` | text | `'openai'` or `'anthropic'` |
| `model` | text | モデル名 |
| `enabled` | boolean | 有効/無効 |
| `key_prefix` | text | APIキーの先頭部分（確認用） |

### API

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/ai-config?orgId=xxx` | AI設定取得（復号化キーは返さない） |
| PUT | `/api/ai-config` | AI設定更新 |

### Hook

`useAiConfig(orgId)` — 組織のAI設定を取得・更新。

## 2. 見積もり支援（Estimation Assist）

### 概要

タスク作成時にタイトルから類似完了タスクを検索し、過去の実績工数を参考値として提示する。

### ロジック (`findSimilarTasks`)

1. タイトルのサブストリングで `ILIKE` 検索（日本語対応）
2. `actual_hours` が記録済みの完了タスクを抽出
3. 平均工数・平均クライアント待機日数を算出

### Hook

`useEstimationAssist({ spaceId, orgId })`:
- `search(title)` — 類似タスク検索（デバウンス付き）
- `result` — `{ similarTasks, avgHours, avgClientWaitDays }`

### セキュリティ

- LIKE/ILIKEワイルドカードのエスケープ（`%`, `_` を無効化）
- RLSによるスペース内スコープ制限

## 3. リスク予測（Risk Forecast）

### 概要

マイルストーンごとに、現在のタスク消化速度（velocity）から期限内完了の可能性を評価する。

### リスクレベル

| レベル | 条件 |
|--------|------|
| `high` | 残日数で消化不可能 |
| `medium` | ギリギリ（ratio 0.8-1.0） |
| `low` | 余裕あり（ratio 1.0-1.5） |
| `none` | 十分な余裕 or データ不足 |

### 評価指標

| 指標 | 説明 |
|------|------|
| `velocity` | 過去14日間のタスク完了速度（件/日） |
| `remainingTasks` | 未完了タスク数 |
| `availableDays` | 期限までの残日数 |
| `requiredDays` | 現velocity での必要日数 |
| `clientBlockedTasks` | クライアントボールのタスク数 |
| `allClientBlocked` | 全残タスクがクライアントボールか |
| `insufficientData` | velocity算出に十分なデータがないか |

### Hook

`useRiskForecast({ tasks, milestones })`:
- 純粋な計算（Supabaseクエリなし、親hookのデータを使用）
- `forecasts: Map<string, RiskAssessment>`
