# P0 実装プラン（UXレビュー 2026-07 由来）

対象Issue: #86（ボール可視化）/ #87（議事録→タスク）/ #88（amber統一）。各テーマとも CLAUDE.md の TDD（Red→Green→Refactor）に従う。

---

## プラン1: ボール可視化・承認履歴の復活（#86）＝ 最小工数・最大効果

**現状**：`portal/page.tsx` は `ballOwnership: { clientCount, teamCount }`(`:355`) と `review_approvals` JOIN(`:132`) を**計算済みだが未描画**。可視化部品も完成しているが孤児。

**確定している型**：
- `BallOwnershipRadar({ clientCount, teamCount, className? })`（`SplitPill` で「あなた/先方」を描画）
- `ApprovalHistory`（承認履歴ウィジェット、要API確認）

**手順**：
1. **Red**: `PortalDashboardClient` に `ballOwnership` と `approvals` を渡し、`BallOwnershipRadar` / `ApprovalHistory` が描画されることを検証するコンポーネントテストを追加（現状は未描画で失敗）。
2. **Green**:
   - `portal/page.tsx` の `dashboardData` に既にある `ballOwnership` / `approvals` を `PortalDashboardClient` の props/JSX へ接続。
   - ダッシュボード上部（ヒーロー付近）に `BallOwnershipRadar` を配置、`ApprovalHistory` を信頼セクションに配置。
3. **Refactor**: 使われなくなる懸念のあった孤児部品を「起こした」ものとして整理。残る真の孤児（`HealthSection`/`AlertBanner`/`ProgressBar`/`MilestoneDot`/`UndoToast`/`HealthBadge`）は本Issue外で起こす/削除を別途判断。

**見積**: Quick（描画結線が主。ロジックは既存）。
**リスク**: 低（読み取り専用の追加描画）。

---

## プラン2: 議事録→タスク抽出UI（#87）＝ 看板機能の開通

**現状**：`MeetingInspector.tsx:209` が `minutes_md` を読み取り専用 `<pre>` で表示するのみ。バックエンドは完成：
- `useMeetings.previewMinutes(meetingId, minutesMd) → { newSpecCount, existingSpecCount, newSpecs[...] }`
- `useMeetings.parseMinutes(meetingId, minutesMd) → { createdCount, createdTasks[{taskId,title,specPath,dueDate,lineNumber}], updatedMinutes }`（冪等・`<!--task:tXXX-->` マーカー付与）

**手順**：
1. **Red**: 会議インスペクタで
   - 議事録編集→「抽出をプレビュー」で `newSpecCount` が表示される
   - 「タスクを作成」で `parseMinutes` が呼ばれ `createdCount` 件が反映される
   - 再実行で二重生成しない（冪等）
   をモックした回帰テストで先に表現（`minutes-parser.test.ts` の隣に UI/フック結線テストを追加）。
2. **Green**:
   - `MeetingInspector` の議事録タブを read-only `<pre>` → 編集可能テキストエリア（or BlockNote流用）に変更。
   - 「抽出をプレビュー」ボタン → `previewMinutes` 呼び出し → 新規/既存リンク済みの差分を表示。
   - 「タスクを作成」ボタン → `parseMinutes` → 生成タスクを一覧表示（`title` + `specPath` + **ボール所有権バッジ**）。
   - 楽観更新・no-save-button 原則に沿わせる（抽出は明示アクションなので許容、通常編集は自動保存）。
3. **Refactor**: 生成タスクのボール導出（`assignee`→`ball` マッピング）を共通化。

**見積**: Medium（UI新規＋差分プレビュー）。
**リスク**: 中（冪等性・タイムゾーン安全は既存パーサが担保。UI結線が主）。
**依存**: 生成タスクのボール（社内/クライアント）決定ルールは要確認（パーサの `assignee` に紐付くか）。

---

## プラン3: amber-500 をクライアント可視専用に統一（#88）

**現状の矛盾**：
- `CLAUDE.md:36` = amber-**500** / `docs/design/DESIGN_SYSTEM.md:39` = Client は amber-**600/bg-amber-50**
- 実装は 500/600/700/100/50 混在。トークンは Tailwind v4 `@theme`（`globals.css:34-39` に `--color-amber-50..600`）
- amber が「警告(`:36 Warning=amber-600`)」「要対応」「保存中」「in_review(`:81`)」にも使用され意味が過負荷

**方針（推奨）**：
- **値は amber-600 に統一**（デザインシステムの既存定義に合わせ、使用箇所も多い）。`CLAUDE.md` の「amber-500」記述を amber-600 に訂正し、単一の真実にする。
- **意味ごとに semantic トークンを分離**：
  - `--color-client` = amber系（クライアント可視。唯一 amber を許可）
  - `--color-warning` = 別系統（例: orange/red 系。締切警告・危険）
  - `--color-attention` = 別系統（要対応・in_review）
  - `--color-saving` = 中立（gray/blue。保存中インジケータ）

**手順**：
1. **Red/検査先行**: `design-system-checker` に「amber の生ハードコードは client 文脈のみ許可」の禁止パターン検査を追加し、現状違反を列挙（Red）。
2. **Green**:
   - `globals.css` に semantic トークン（client/warning/attention/saving）を定義。
   - 非クライアント用途の amber を各 semantic トークンへ置換（締切=warning、要対応/in_review=attention、Wiki保存中=saving）。
   - ポータルの「承認」主アクション色を1つ（client=amber-600）に統一（indigo/green/emerald を撤去）。
3. **Refactor**: `AmberBadge`/`AmberDot` を client トークン参照に統一。`taskapp-design-system` スキルの値も同期。

**見積**: Medium（全面置換だが機械的。`design-system-checker` で網羅）。
**リスク**: 中（見た目の広域変更。まず検査で違反箇所を確定してから置換）。
**注意**: これはデザインシステム根幹の判断を含むため、トークン設計の確定は上位判断（必要なら Fable）で行い、置換自体は Sonnet/impl-runner で量産可能。

---

## 実施順の推奨
1. **#86 ボール可視化**（Quick・低リスク・中核メタファ復活）→ すぐ着手可
2. **#88 amber 検査先行**（違反確定まで先に）→ 置換は並行量産
3. **#87 議事録→タスク**（Medium・看板機能）

各テーマは 1ストリーム=1ブランチ=1PR（CLAUDE.md）。#88 のデザイントークン確定のみ上位判断を挟む。
