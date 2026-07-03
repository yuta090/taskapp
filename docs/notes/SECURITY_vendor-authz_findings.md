# ベンダー認可 調査結果と判断依頼（V3 / V5）

UXレビュー(#90 #91)由来。`security/vendor-authz` ブランチ・独立worktreeで対応。

## V5: 招待の自動承認（対応済み）

**問題**：ログイン中ユーザーのメールが招待メールと不一致でも、そのセッションに招待を自動承認していた（wrong-account join）。

**対応**：`src/lib/invite/emailMatch.ts` に `shouldAutoAcceptInvite(sessionEmail, inviteEmail)` を純関数化（大文字小文字・空白無視で比較）。不一致時は自動承認せず、招待先/現在メールを提示して「別アカウントでログインし直す」導線を出す。純関数を単体テストで検証（`emailMatch.test.ts`）。

**残課題**：招待メール ↔ サインアップ強制の一致（signup 経路 line 52 `email: inviteInfo.email`）は既に招待メール固定なので問題なし。UXコピーの最終調整は要レビュー。

---

## V3: ベンダーへのタスク露出（**判断依頼＝境界設計が必要**）

### 確認済みの現状
- ベンダーは `space_memberships.role = 'vendor'`（`agency_mode=true` の space）。
- タスク取得（`src/app/vendor-portal/tasks/page.tsx:38-45`）は **`client_scope` フィルタ無し**・`.neq('status','done')` のみ → **space内の全非doneタスクを返す**。
- **DDLに vendor 用の RLS ポリシーが存在しない**（`docs/db/*.sql` に `vendor` の記述ゼロ）。→ RLSはベンダーを絞っておらず、クライアント/内部タスクが露出しうる。
- `client_scope` カラムは存在：`('deliverable' | 'internal')`（`DDL_v0.5_client_scope.sql`）。DDLコメントには「クライアントロールは deliverable のみ閲覧可」とあるが、**ベンダーロールの定義は無い**。

### なぜ即修正しないか（規約）
CLAUDE.md：**認可境界の新規設計・RLS境界の新規設計はFable級**。かつ security は独立worktree。クエリに `client_scope` を足すだけでは：
1. **RLSでサーバー側強制されない**（ベンダーが直接クエリを叩ける前提では不十分）
2. **「ベンダーは何を見るべきか」の仕様が未定**（下記）で、誤ると正当なベンダー作業導線を壊す

### 決めるべき境界（要判断）
1. **ベンダーの可視範囲**：
   - 案A：`client_scope='deliverable'` のみ（クライアント成果物のみ）
   - 案B：`deliverable + internal` 両方（自社作業も見る＝現コメントの意図）
   - 案C：`ball` 次元で制御（vendor/internalボールのみ、clientボールは隠す）
   - ※ `client_scope` と `ball` は直交。露出の主因は「clientボールのタスクが見える」ことなので、案C（またはA+C）が本質的か要検討。
2. **RLSポリシー**：`tasks` にベンダーロール用の SELECT ポリシーを新設（space_membership.role='vendor' のとき上記範囲に限定）。
3. **多面適用**：同様の露出が `vendor-portal` の他取得（今後の meetings/wiki 等）にも波及しないか。

### 実装タスク（境界確定後）
- [ ] クエリ側フィルタ追加（`vendor-portal/tasks/page.tsx`）
- [ ] `tasks` のベンダーSELECT RLS新設（DDL差分：`migration-writer`）
- [ ] RLS回帰テスト（ベンダーセッションで client ボール/対象外scopeが返らない）
- [ ] UI回帰テスト（一覧に対象外が出ない）

---

## 提案：ここで Fable への切替を推奨
V3 は「型なし × 失敗コスト大（認可漏れ）× 全体俯瞰（RLS境界の新規設計）」に該当。机は整えた（現状調査・カラム有無・選択肢・実装タスクを上記に整理済み）。境界（案A/B/C）と RLS 設計の確定を Fable で行い、確定後の DDL/クエリ実装は Sonnet/`migration-writer`・`impl-runner` で量産する。
