# Task App UI Rules / Screen Specs（このプロジェクトの“憲法”）

## 絶対ルール（破ったらバグ扱い）
- **1画面1目的**：メインビューはその画面の「主役」のリスト表示に徹する（詳細編集は右ペイン）。
- **3ペイン固定**：[左 Nav] - [中 Main] - [右 Inspector]。Inspectorは**Overlay禁止**。必ずMainをリサイズして表示。
- **Amber Rule**：クライアントに見えている要素は必ず **Amber-500** のアイコン/バッジを付与。
- **リスト密度**：1行1情報（Discussionのみ例外で2行目あり）。行高 32–40px。

## 編集UIは3種類だけ（追加禁止）
1) **Inspector（右ペイン）**：編集の本体。行クリックで開く（`?task=<id>`）。Escで閉じる。上部に「最優先アクション」を固定。
2) **Inline Popover（小ポップアップ）**：単一フィールド変更（Assignee / Due / Priority / Labels / Milestone）。Enter確定/Escキャンセル。**Optimistic即時保存**。
3) **Create Sheet（新規作成シート）**：新規作成の最初だけ。**Title最小**でEnter作成→自動でInspectorへ遷移。編集用途での利用は禁止。

## 画面仕様
### A. Inbox（受信トレイ） `/inbox`
- ヘッダー：Inbox専用フィルタ（重要/その他/スヌーズ）＋「すべて既読」。
- 行クリック：**Inbox Inspector**（Task Inspectorではない）。
- **アクション通知と告知通知の区別**:
  - アクション必要な通知（`review_request`, `ball_passed`, `task_assigned`, `confirmation_request`, `urgent_confirmation`, `spec_decision_needed`）は未読時に **「要対応」バッジ** を表示。
  - Inbox Inspector内で通知タイプ別のインラインアクションパネルを表示:
    - `review_request` → 承認する / 差し戻す（理由入力付き）
    - `ball_passed` / `task_assigned` → 対応開始して次へ
    - `confirmation_request` / `urgent_confirmation` → 日程を回答する（リンク遷移）
    - `spec_decision_needed` → 決定済みにする
  - アクション完了後、600ms後に自動で既読+次の通知へ遷移。
  - 告知通知（`task_completed`, `meeting_ended`, `due_date_reminder` 等）は「既読にして次へ」のみ。
- 「詳細を見る」→ Project画面へ遷移して Task Inspector を開く。

### B. Tasks List（プロジェクト） `/:orgId/project/:spaceId`
- ヘッダー：Projectタブ（すべて/アクティブ/バックログなど）
- 行クリック：Task Inspectorを開く（Mainをリサイズ）
- 公開トグル：ONにする際は必ず確認ステップ（プレビュー）を挟む（即時反映禁止）。

### C. Meetings `/:orgId/project/:spaceId/meetings`
- 右ペイン：Transcript | Extract | Apply タブ
- Apply後：画面遷移せず、右ペインの中身だけが生成されたTask/DiscussionのInspectorに切り替わる。

### D. Client Portal `/portal/:token`（クライアント）
- 権限：閲覧＋コメントのみ。編集不可。
- Safety：内部情報（TP-ID / GitHubリンク / 社内用ラベル）を表示しない。
- Ball Ownership：クライアントがコメント返信→ステータス自動で `waiting_dev` へ。

### E. Space Create Sheet（プロジェクト新規作成）
- **エントリポイント**: LeftNavの「チーム」セクションヘッダ横「+」ボタン（プロジェクトルート上でのみ表示）。
- **形状**: Bottom-sheet（backdrop付き）。3ペインの上にoverlay。
- **2ステップフロー**:
  - **Step 1（ジャンル選択）**: 3列カードグリッド（6ジャンル）+ 下部に「白紙から始める」テキストリンク。各カードにアイコン・ラベル・説明・「Wiki X件 / MS X件」表示。
  - **Step 2（名前入力+確認）**: 選択ジャンルバッジ + [変更]リンク、プロジェクト名input（autoFocus）、プレビュー（作成されるWiki/マイルストーン名）、[キャンセル]/[作成]ボタン。
- **作成中**: ボタンにSpinnerGap表示、disabled。
- **作成完了**: Sheet閉じ → `/${orgId}/project/${newSpaceId}` へ自動ナビゲーション。
- **閉じ方**: Xボタン / Backdrop クリック。全stateリセット。

## NG（禁止）
- タスク詳細を中央モーダルで開く。
- 編集のために別ページへ遷移する。
- 保存ボタンを押すまで反映されないUI（Optimistic必須）。
- 右ペインがリストに覆いかぶさる（Overlay）→必ずリサイズ。
