# Task App UI Rules / Screen Specs（このプロジェクトの“憲法”）

## 絶対ルール（破ったらバグ扱い）
- **1画面1目的**：メインビューはその画面の「主役」のリスト表示に徹する（詳細編集は右ペイン）。
- **3ペイン固定**：[左 Nav] - [中 Main] - [右 Inspector]。Inspectorは**Overlay禁止**。必ずMainをリサイズして表示。**← この規則は `md`(768px)以上のデスクトップ限定**。`md`未満のモバイルでは Inspector は Main をリサイズせず**全画面シートとしてオーバーレイ**する（単一インスタンスをクラス切替で開閉・二重マウント禁止）。LeftNav はハンバーガー＋drawer。ブレークポイントは portal と統一し**必ず `md`**。ガント編集は**desktop-only**（モバイルは推奨バナーでゲート）。
- **Amber Rule**：クライアントに見えている要素は必ず **Amber-500** のアイコン/バッジを付与。
- **リスト密度**：1行1情報（Discussionのみ例外で2行目あり）。行高 32–40px。

## 編集UIは3種類だけ（追加禁止）
1) **Inspector（右ペイン）**：編集の本体。行クリックで開く（`?task=<id>`）。Escで閉じる。上部に「最優先アクション」を固定。
2) **Inline Popover（小ポップアップ）**：単一フィールド変更（Assignee / Due / Priority / Labels / Milestone）。Enter確定/Escキャンセル。**Optimistic即時保存**。
3) **Create Sheet（新規作成シート）**：新規作成の最初だけ。**Title最小**でEnter作成→自動でInspectorへ遷移。編集用途での利用は禁止。

## 用語辞書（Terminology）
同じ概念に複数のラベルが乱立すると認知負荷が上がるため、内部UIの表示ラベルを以下に統一する。**DB値・API・フィルタのクエリパラメータ（例: `filter=client_wait`, `ball='client'`, `status='in_review'`）は変更しない。表示ラベルのみのルール。**

| 概念 | 内部UIラベル | ポータル（クライアント）ラベル |
|------|-------------|------------------------------|
| ボール＝外部（クライアントの確認/承認待ち。`ball='client'`） | **クライアント確認待ち**（サイドバーリンク・フィルタチップ・フィルタタブ・行バッジ・パンくず・ガント凡例・Slack通知すべてで統一） | 変更なし（クライアント自身の画面のため対象外） |
| 社内承認フロー（承認者は社内メンバーのみ。`reviews`/`review_approvals`、`TaskReviewSection`） | **社内承認**（見出し）／**社内承認を依頼**（ボタン）／**社内承認待ち**・**社内承認済み**（状態）／**社内承認依頼**（Inbox通知タイプ・通知設定） | 変更なし（内部限定機能） |
| タスクステータス `todo` | **着手予定**（旧: 「ToDo」「Todo」「TODO」表記ゆれ） | **着手予定** |
| タスクステータス `in_review` | **社内承認中**（旧: 「承認確認中」「確認中」表記ゆれ。上記「社内承認フロー」と同じ概念） | **社内確認中**（「承認」の語を避け、クライアント自身の承認待ちとの誤解を防ぐ） |
| 通知のアクション必要フラグ（`review_request` 等、Inboxのバッジ） | 「要対応」（変更なし。上記のボール/承認とは別概念） | 「要対応」「要確認」（変更なし） |

- 「確認待ち」を内部UI単体で使わない（必ず「クライアント確認待ち」と主体を明示）。「承認待ち」も同様に必ず「社内承認待ち」と主体を明示する。
- 承認者選択UIを開いたときは「クライアントへの確認依頼はボールを『外部』に切り替えてください」のヒントを表示し、社内承認とクライアント確認待ちを混同させない。

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

### F. Settings（プロジェクト設定） `/:orgId/project/:spaceId/settings`
- **レイアウト**: Main pane内で [サイドバーナビ: 200px] + [コンテンツ: flex-1]。3ペインのInspectorとは共存しない。
- **サイドバーナビ**: 5カテゴリに分類。各カテゴリにラベル+アイテム一覧。
  - **プロジェクト運用**: 基本設定（+プリセット）、マイルストーン、メンバー
  - **外部連携**: GitHub、Slack、Google Calendar、ビデオ会議
  - **AI・自動化**: AI設定
  - **セキュリティ・API**: APIキー
  - **データ管理**: データエクスポート
- **ステータスバッジ**: 外部連携項目にドット表示（emerald=接続済み / gray=未接続 / amber+pulse=期限切れ間近7日以内）。カテゴリヘッダに未対応件数バッジ。
- **検索**: サイドバー上部に検索バー。日本語/英語キーワードで絞込み。`/` or `Cmd+K` でフォーカス。
- **セットアップバナー**: 新規プロジェクト向け。3ステップ（メンバー追加 / マイルストーン設定 / 外部連携）。プログレスバー付き。全完了で自動非表示。`×` で手動非表示（localStorage保存、spaceId単位）。
- **コンテンツ切替**: ナビクリックで右側コンテンツを切替。スクロールなしの1セクション表示。デフォルトは「基本設定」。
- **エラー通知**: `toast.error()` (sonner) を使用。`alert()` 使用禁止。

## NG（禁止）
- タスク詳細を中央モーダルで開く。
- 編集のために別ページへ遷移する。
- 保存ボタンを押すまで反映されないUI（Optimistic必須）。
- 右ペインがリストに覆いかぶさる（Overlay）→必ずリサイズ。
- 設定画面で `alert()` を使用する（`toast.error()` を使うこと）。
