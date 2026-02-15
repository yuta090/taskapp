# MCP Tool Governance v1.0

MCPツール管理のガバナンスルール。コンテキストウィンドウの効率的利用と開発体験の維持を目的とする。

## 4層アクセスモデル

```
Tier 1: Direct MCP Tools   — 高頻度CRUD、AIが自律的に選択
Tier 2: Skills              — 複数ツール組合せワークフロー、AIがコンテキストで発動
Tier 3: Commands            — ユーザー起動 /xxx、定型レポート出力
Tier 4: Agents              — 長時間・横断タスク（将来拡張枠）
```

### Tier判定フローチャート

```
新ツール/機能の追加要求
  ├─ 単一CRUD操作か？
  │   └─ YES → Tier 1: MCP Tool
  ├─ 複数ツールの組合せが必要か？
  │   └─ YES → Tier 2: Skill
  ├─ ユーザーが明示的に起動するか？
  │   └─ YES → Tier 3: Command
  └─ 長時間・自律実行が必要か？
      └─ YES → Tier 4: Agent
```

## ツール数ガイドライン

| Tier | 推奨範囲 | 現在 |
|------|---------|------|
| Tier 1 (MCP Tools) | 40-60 | 56 |
| Tier 2 (Skills) | 5-15 | 5 |
| Tier 3 (Commands) | 5-15 | 5 |
| Tier 4 (Agents) | 0-5 | 0 |
| **合計** | **50-95** | **66** |

MCPツール単体が80を超える場合は、Skills/Commandsへの移行を検討。

## 説明文品質基準

### ルール
1. **120文字以内**に収める
2. **動詞+対象**で開始（例: 「タスク新規作成」「レビュー承認」）
3. **丁寧体禁止**（「〜します。」→ 体言止めまたは常体）
4. **必須条件は明記**（例: 「ball=client時clientOwnerIds必須」）
5. **フィルタ可能な場合は記載**（例: 「statusフィルタ可」）
6. **破壊的操作に【破壊的】プレフィックス**
7. **横断操作に【横断】プレフィックス**

### テンプレート

```
// 基本CRUD
'{動詞}{対象}。{条件/フィルタ}'

// 破壊的操作
'【破壊的】{動詞}{対象}。{安全機構の説明}'

// 横断操作
'【横断】{動詞}{対象}。{必要条件}'
```

### 良い例 / 悪い例

| 良い例 | 悪い例 |
|--------|--------|
| `タスク新規作成。ball=client時clientOwnerIds必須` | `タスクを新規作成します。spaceIdは必須です。ball=clientの場合はclientOwnerIdsが必須です。` |
| `会議一覧取得。statusフィルタ可` | `会議一覧を取得します。statusでフィルタ可能。` |
| `【破壊的】タスク削除。dryRun=true(既定)で確認` | `【破壊的操作】タスクを削除します。デフォルトはdryRun=trueで影響確認のみ。` |

## 新ツール追加チェックリスト

新しいMCPツールを追加する前に、以下を確認：

- [ ] **Tier判定**: 上記フローチャートでTier 1に該当するか確認
- [ ] **重複チェック**: 既存ツールと機能が重複しないか確認
- [ ] **説明文**: 120文字以内、動詞+対象で開始、必須条件明記
- [ ] **スキーマ**: Zod schemaのdescribeが各フィールドにあるか
- [ ] **権限チェック**: `checkAuth()` または org/space スコーピングが実装されているか
- [ ] **ビルド確認**: `npx tsc --noEmit && npm run build` が通るか

## ファイル構成

```
.claude/
├── skills/                    # Tier 2: Skills
│   ├── meeting-flow.md
│   ├── scheduling-wizard.md
│   ├── project-status.md
│   ├── client-onboarding.md
│   └── review-cycle.md
├── commands/                  # Tier 3: Commands
│   ├── project-overview.md
│   ├── ball-status.md
│   ├── open-reviews.md
│   ├── pending-scheduling.md
│   └── activity-digest.md
└── agents/                    # Tier 4: Agents (将来拡張)

packages/mcp-server/src/tools/ # Tier 1: MCP Tools
├── tasks.ts       (6)
├── ball.ts        (3)
├── meetings.ts    (5)
├── reviews.ts     (5)
├── milestones.ts  (5)
├── spaces.ts      (4)
├── activity.ts    (3)
├── clients.ts     (8)
├── wiki.ts        (6)
├── minutes.ts     (3)
└── scheduling.ts  (8)
```
