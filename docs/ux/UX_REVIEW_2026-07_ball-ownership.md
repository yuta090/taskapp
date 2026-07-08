# TaskApp UX総合レビュー — 受託・社内開発の課題への適合度（2026-07-03）

> 6面（内部タスクcore／会議・日程・レビュー・ダッシュボード／ガント・バーンダウン・Wiki・横断ビュー／クライアントポータル／ベンダーポータル・通知・オンボーディング／横断シェル・ナビ・状態）の実コード精読に基づく統合レビュー。すべての指摘に `file:line` 根拠を付す。

## 結論

**コンセプトはほぼ満点、実装が追いついていない。** 「ボール所有権（次に誰が動くか）」という設計思想は、受託/社内開発の現場課題にほぼ1対1で対応している。しかし全UIを精読すると、**核心的な価値がデータ層では計算・記録されているのにUIで表に出ていない（埋もれる／行き止まり／死にコード）** という同じ失敗が繰り返し起きており、製品の約束を各所で削いでいる。

問題は3つのメタテーマに集約される。

- **テーマA：核心価値がUIで死んでいる** — 議事録→タスク抽出、意思決定記録、リスク検知、レビューキュー、ガント変更履歴、ボール可視化、承認記録が「作られているのに使えない/見えない」。
- **テーマB：amber-500（＝クライアント可視）の意味崩壊** — 唯一の視覚的差別化要素なのに「警告」「緊急」「保存中」「要対応」にも使われ、しかもルール(500)とデザインシステム(600)が矛盾。
- **テーマC：実装の一貫性負債** — 禁止のはずのモーダル、必須のはずの楽観更新に保存ボタン、名前でなくUUID表示、状態表示の場当たり実装、ベンダー/ポータルの作りかけ・死にコード。

---

## 課題スコアカード（抽出10課題 × 達成度）

| # | 受託・社内開発の一般課題 | 設計思想 | UX実装 | 一言 |
|---|---|:---:|:---:|---|
| 1 | 責任の所在（次に誰が動く） | ◎ | ○ | クライアントボールは明快。社内ボールは「amberが無い」＝不在でしか表現されず不可視。行からボールを渡せない |
| 2 | 進捗の可視化（社内/クライアント） | ◎ | ○ | ダッシュボード・ポータルは強い。ガント/バーンダウンは過去に強いが将来予測なし。KPIが押せず行き止まり |
| 3 | コミュニケーション分散 | ○ | △ | GitHubは良い。Slackは一方向の手動プッシュ（後付け）。通知payloadにagency/vendorボールを表現できない |
| 4 | 仕様変更・意思決定の記録 | ◎ | △ | 記録機構は優秀だが詳細設定の3階層下に埋没。ガント変更履歴は取得後に破棄。actorがUUID表示 |
| 5 | スコープ/見積の膨張 | ○ | △ | 単価UIはあるが合計ロールアップ皆無。`deliverable`スコープ限定表示で、内製が課金化する“膨張時”に非表示 |
| 6 | 会議・議事録・日程調整 | ◎ | △ | 日程調整は秀逸。議事録→タスク抽出パイプラインがUIから到達不能（`<pre>`で終わる）。決定事項生成は未確認のバックエンド頼み |
| 7 | レビュー・承認の滞留 | ◎ | △ | タスク内レビューは可。専用レビューキューは死にコード、ダッシュボードの件数は行き止まり、深リンクにバグ |
| 8 | リスク・温度感の検知 | ◎ | △ | エンジンはあるがガント内でしか見えない。新規案件で誤アラーム、クライアント起因の遅延を自社のせいに赤表示 |
| 9 | オンボーディング/引き継ぎ | ○ | △ | ウォークスルーは受動的モーダルで2者ボールのみ。Wikiに検索なし＝仕様が探せない。マイタスクはフルリロード |
| 10 | 通知過多で埋もれる | ○ | △ | 受信トレイのフィルタは良い。分類は最小限、リアルタイムなし、バッジ件数が2箇所で不一致、一覧にボール件数バッジなし |

---

## テーマA：核心価値がUIで死んでいる

1. **議事録→タスク化がUIから到達不能** — パーサ(`src/lib/minutes-parser.ts:46`)もフック(`useMeetings.ts:328,368` `parseMinutes/previewMinutes`)も完成しているのに、`MeetingInspector.tsx:209` は`minutes_md`を読み取り専用`<pre>`で表示するだけ。抽出ボタンもプレビューも無い。看板機能がタグで終わっている。
2. **意思決定記録が3階層下に埋没** — `ConsideringDecisionPanel` は Inspector→詳細設定→specブロック→`decision_state==='considering'` の時だけ表示(`TaskInspector.tsx:1434`)。`TaskEventTimeline`も既定折りたたみ(`:91`)。アンチ紛争の最重要機能が最も見つけにくい。
3. **レビューキューが死にコード** — `ReviewList.tsx`/`ReviewInspector.tsx`は参照ゼロ、approve/blockハンドラも未接続。集約面が無く、ダッシュボードの「レビュー待ち」件数(`DashboardClient.tsx:547`)は押せず行き止まり。
4. **リスクがガントの中だけ** — `useRiskForecast`は計算済みなのにMy/受信トレイ/バーンダウンに出ない。新規案件はvelocity=0で常に赤（誤アラーム、`calculateRisk.ts:89`）、クライアント起因の遅延を自社のせいに赤表示（`allClientBlocked`はツールチップのみ、`:75`）。バーンダウンにも予測線なし。
5. **ガント変更履歴を取得して捨てている** — before/after値を`updateLog`(`GanttPageClient.tsx:52`)に取っているがメモリのみ、リロードで消滅、Undoなし。「誰がいつ納期を動かしたか」を守れない。
6. **ポータル：ボール所有権がクライアントに一度も表示されない** — `ballOwnership`は計算済み(`portal/page.tsx:356`)なのに未描画。`BallOwnershipRadar`（“あなた/先方”可視化）は孤児。製品の中心メタファがクライアント画面に出ていない。
7. **ポータル：承認記録を取得して捨てている** — `review_approvals`をサーバーJOIN(`portal/page.tsx:132`)して未描画。`ApprovalHistory`も孤児。

**孤児コンポーネント（参照ゼロ、要起こし or 削除）**：`BallOwnershipRadar` / `ApprovalHistory` / `HealthSection` / `AlertBanner`(`DeadlineAlert`) / `ProgressBar` / `MilestoneDot` / `UndoToast` / `HealthBadge` / `SplitPill`、レガシーnav三点`PortalSidebar`/`PortalHeader`/`PortalLayout`、内部`ReviewList`/`ReviewInspector`。

---

## テーマB：amber-500の意味崩壊

- **意味の過負荷**：amberが「クライアント可視」に加え、締切警告(`gantt/constants.ts:42`)、要対応(`InboxClient.tsx:202`)、設定の警告ドット(`SettingsLayout.tsx:95`)、Wiki保存中(`WikiPageClient.tsx:207`)にも使用。amberを見ても「クライアント絡みか」を判断できない。
- **値の矛盾**：`CLAUDE.md:36`は amber-**500**、`DESIGN_SYSTEM.md`は amber-**600/50**。実コードは 500/600/700/100/50 混在（厳密に500は`AmberDot`のみ）。
- **ポータルの承認ボタンが面ごとに色違い**：indigo(`ui/ActionCard.tsx:156`)／green(`PortalTaskInspector.tsx:209`)／emerald(`PortalTaskDetailClient.tsx:294`)／amber(`EmailActionClient.tsx:167`)。非技術クライアントに“安全な主アクション”の視覚的アンカーが無い。

→ **amberは「クライアントが見る」専用に戻し、警告/要対応/保存中は別トークンへ。** この1点でボール可視性という中核体験が明確に改善。

---

## テーマC：一貫性・実装負債

- **モーダル禁止違反**：`TaskCreateSheet`（モバイル中央モーダル `:135`）、`MeetingCreateSheet`/`ProposalCreateSheet`（`fixed inset-0 bg-black/30`）、`WikiCreateSheet`、`InternalOnboardingWalkthrough`、`PortalOnboardingWalkthrough:166`、`integrations/page.tsx:68`の`window.confirm()`、`TaskInspector`削除`confirm()`、`portal/settings:49`の`confirm()`。
- **楽観更新違反（保存ボタン残存）**：`TaskInspector`説明欄(`:569`)・オーナー編集(`:1193`)、日程回答`SlotResponseGrid`「回答を送信」(`:433`)。ヘッダーは「自動保存」表示なのに矛盾。ポータルは`/portal/tasks`のみ楽観、ダッシュボードは`router.refresh()`頼み。Undoは完成部品(`UndoToast`)があるのに未接続で承認取り消し不能。
- **ユーザーにUUID露出**：`TaskEventTimeline`/`TaskComments`のactor、`MeetingInspector`参加者、`ReviewInspector`のreviewer_id。名前解決していない。
- **ベンダーポータルが作りかけ**：ナビ6中4が404(`VendorLeftNav.tsx:28`)、タスクを開けない（Inspector未接続）、`done`が選べず完了不能＝ボールを返せない、`client_scope`未適用で社内タスク露出の疑い(`vendor-portal/tasks/page.tsx:38`)。
- **専門用語漏れ（クライアント面）**：会議議事録が生markdown(`PortalMeetingsClient.tsx:99`)、spec生パス表示(`PortalTaskDetailClient.tsx:240`)、"Wiki"/"Todo"未訳(`PortalLeftNav.tsx:240`,`labels.ts:12`)、"チーム対応中"なのに承認要求の矛盾ラベル(`PortalTasksClient.tsx:299`)。
- **状態表示の場当たり**：`LoadingState/EmptyState/ErrorRetry`は良い共通部品だが採用は各3〜4ファイルのみ。~31ファイルが独自スピナー、~74ファイルが独自空表示。
- **アクセシビリティ穴**：`StatusDropdown`(`TaskRow.tsx:82`)・`MilestoneGroupHeader`・`TaskFilterMenu`・`CommandPalette`がマウス専用/dialogセマンティクス欠落。ガントは完全マウス専用でキーボード/タッチ不可。内部AppShellにレスポンシブ無し。

---

## 対クライアント面の信頼を損なう実害バグ（ポータル）

1. **共有ファイルが一切開けない/DLできない** — `PortalFilesClient.tsx:80` は`href`もonClickも無い表示専用。
2. **偽の進捗50%を表示** — `MilestoneTimeline.tsx:69` が現行マイルストーンを`w-1/2`固定（`// Illustrative visual 50%`）。
3. **日程調整ページがナビから到達不能** — `PortalLeftNav.tsx:234` に項目なし。メールリンク経由でしか行けない。
4. **全タスクの「要確認」が行き止まり** — インスペクタを`onApprove`無しで開く(`PortalAllTasksClient.tsx:143`)。承認バッジなのに承認できない。
5. **設定に無反応トグルと死んだ「パスワード変更」ボタン**(`PortalSettingsClient.tsx:111,274`)。

---

## 要検証の機能バグ疑い（実挙動確認推奨）

| # | 疑い | 根拠 |
|---|---|---|
| V1 | ダッシュボード→会議の深リンク不一致（死にクリック） | `DashboardClient.tsx:466` `?meetingId=` vs `MeetingsPageClient.tsx:83` `?meeting=` |
| V2 | 見積送信が保存されない（フィールド欠落） | `TasksPageClient.tsx:399` が `estimatedCost/estimateStatus` を落とす vs `TaskInspector.tsx:40,296` |
| V3 | ベンダーに社内タスク露出 | `vendor-portal/tasks/page.tsx:38` が`client_scope`未適用 |
| V4 | 「渡してN日」が過小報告 | `DashboardClient.tsx:58` が`updated_at`を代理利用 |
| V5 | ベンダー招待が別アカウントでも自動承認 | `vendor-portal/[token]/page.tsx:107` メール不一致でも承認 |

---

## 優先度つき改善ロードマップ

### P0（核心の約束を守る／信頼バグ）
1. ポータル：ファイルDL不能を修正（`PortalFilesClient.tsx:80`）
2. ポータル：偽50%進捗を実データ化（`MilestoneTimeline.tsx:69`）
3. 社内/ポータル：ボール所有権＋意思決定記録を第1階層で可視化（孤児部品を起こす）
4. 議事録→タスク抽出をUIに露出（抽出ボタン＋差分プレビュー＋生成タスクのボール表示）
5. amber-500をクライアント可視専用に統一（承認ボタン色も統一）＋警告/保存中を別トークン化
6. リスクをMy/一覧の先頭に昇格＋クライアント起因遅延の誤赤修正

### P1（滞留と探しやすさ）
7. レビューキュー面を実装（死にコードを起こす）＋ダッシュボード件数にドリルイン
8. Wikiに検索/ソート/フィルタ
9. タスク一覧タブに件数バッジ＋「N件自分待ち/Mクライアント待ち」サマリ
10. ポータル：日程調整をナビに追加、全タスク「要確認」を承認可能に
11. ベンダーポータルの死にリンク・完了不可・社内露出を修正

### P2（一貫性・a11y）
12. 生成系モーダル→スライドシート統一、`window.confirm`→`ConfirmDialog`
13. UUID→メンバー名解決を共通化、共通状態部品を全面採用
14. カスタムドロップダウン/CommandPaletteにキーボード＋dialogセマンティクス、ガントにキーボード操作
15. 専門用語漏れ除去（議事録markdown描画、spec生パス隠蔽、"Wiki"/"Todo"翻訳、矛盾ラベル修正）
16. amberハードコード/チーム色をトークン化、内部AppShellのレスポンシブ対応

---

*生成: 6並列サブエージェントによる実コード精読の統合。各指摘の`file:line`は上記の通り。*
