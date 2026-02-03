# REVIEW_SPEC v0.2（Draft / 運用仕様）

> 正本は `spec/` 配下の Markdown。Wiki は索引（リンク集）に限定する。

---

## 1. 用語

- **検討中（Considering）**: 仕様・判断待ち・条件確定待ちを表す状態。`tasks.status = considering`
- **ボール（ball）**: 次に動く主体
  - `client`: お客様確認待ち
  - `internal`: 当社対応中
- **仕様タスク（SPEC）**: 仕様の意思決定を管理するタスク  
  - `tasks.type = spec`
  - `tasks.specPath` 必須（`/spec/*.md#anchor`）
  - `tasks.decisionState = considering | decided | implemented`

---

## 2. 仕様タスク（SPEC）の運用ルール

### 2.1 必須フィールド
- `type=spec`
- `specPath`: `/spec/REVIEW_SPEC.md#xxx` のように **ファイル + アンカー**で指定（必須）
- `decisionState`:
  - `considering`: 未決
  - `decided`: 決定済み（通知対象）
  - `implemented`: 正本（spec/）へ反映済み

### 2.2 状態遷移（固定）
- `considering → decided → implemented`
- `decided` と `implemented` は **絶対に混ぜない**
  - 会議で決めただけでは `implemented` にしない
  - 正本に反映して初めて `implemented`

### 2.3 決定内容（ログ）
`decided` にする操作は必ずイベントログに残す。

- 会議内で決定:
  - `event.type = decided_in_meeting`
  - `actorId`: 入力者（当社）
  - `onBehalfOf = client`（意思決定主体）
  - `confirmedBy`: クライアント側の確認相手（指名なし運用でも「誰に確認したか」は入力）
  - `note`: 決定内容
- 会議外で決定（チャット等）:
  - `event.type = resolved_outside`
  - `evidence = chat | email | call | other`
  - `confirmedBy` 必須（会議外は特に必須）

---

## 3. 検討中（Considering）の解決ルール

### 3.1 原則
- 起案は軽く（入力少なめ）
- **ステータス変更は慎重**（ログ必須）
- `ball=client` に切り替える瞬間は **clientOwnerIds 1名以上必須**
  - 連続作成時は直前の `clientOwnerIds` を自動引き継ぎ

### 3.2 会議外で確定した場合
会議前にチャットなどで仕様が確定するケースがあるため、タスク詳細で「会議外で解決」を提供する。

- 「クライアント確定として登録」を ON の場合
  - `confirmedBy` 必須
  - `evidence` 必須
  - `task.status: considering → todo`
  - `ball: client → internal`
  - `event` を残す（actor と onBehalfOf を分離）

---

## 4. 会議（議事録）仕様

### 4.1 会議はミーティングごとに作成
- プロジェクト固定 1 つではない
- 一覧で履歴管理

### 4.2 議事録（Markdown）とタスク化（A方式）
議事録本文は Markdown で編集し、以下のチェックボックス記法をパースしてタスク化する。

#### 記法
- 仕様タスク（未決）:
  - `- [ ] SPEC(/spec/REVIEW_SPEC.md#xxx): 〇〇を決める（期限: 2/10, 担当: 山田）`
- 仕様タスク（決定済み）:
  - `- [x] SPEC(/spec/REVIEW_SPEC.md#xxx): 〇〇に決定（根拠は議事録参照）`
- 通常タスク:
  - `- [ ] TODO: 〇〇を対応（期限: 2/05）`

#### 重複生成防止
タスク化時、行末に `<!--task:t123-->` を自動追記し、次回パースでは更新に回す。

---

## 5. 会議終了通知（自動生成）

会議終了時に「決定事項」と「未決事項」を自動集計し、通知文面を生成する。

- 件数を必ず出す（決定 n / 未決 n）
- 未決は期限があるものを優先して列挙
- 配信:
  - メール（外部）
  - アプリ内（inbox/通知）

---

## 6. Wiki の扱い（索引のみ）

Wiki は以下に限定する。
- 仕様ファイル一覧（リンク）
- 重要セクションのショートカット（アンカーリンク）
- 変更履歴のハイライト（任意）

**仕様本文は置かない**（二重管理を禁止）。
