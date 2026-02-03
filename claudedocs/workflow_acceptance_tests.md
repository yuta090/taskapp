# 受け入れテスト対応 実装ワークフロー

> 生成日: 2026-02-03
> 対象: AT-001〜AT-012 未実装仕様

---

## 概要

REVIEW_SPEC.md の受け入れテスト（AT-001〜AT-012）および関連仕様の未実装部分を順次実装するワークフロー。

### 実装優先度

| 優先度 | 対象 | 複雑度 | 影響範囲 |
|--------|------|--------|----------|
| 1 | AT-001, AT-002 | 低 | 会議機能 |
| 2 | AT-009 | 中 | TaskInspector |
| 3 | AT-003, AT-004 | 中 | 通知システム |
| 4 | AT-011 | 高 | Edge Function |
| 5 | Client Portal | 高 | 新規画面 |
| 6 | AT-005 | 高 | 議事録パーサー |

---

## フェーズ1: 会議バリデーション強化

### 1.1 AT-001: 会議作成時のクライアント参加者必須バリデーション

**目的**: クライアント参加者0名では会議を保存できないようにする

**対象ファイル**:
- `src/lib/hooks/useMeetings.ts`
- `src/app/(internal)/[orgId]/project/[spaceId]/meetings/MeetingsPageClient.tsx`

**タスク**:
- [ ] 1.1.1 `createMeeting`に`participantIds`パラメータ追加
- [ ] 1.1.2 クライアント参加者の存在チェック追加
- [ ] 1.1.3 UI側でエラーメッセージ表示
- [ ] 1.1.4 会議作成フォームに参加者選択UI追加

**検証**:
```
✓ クライアント参加者0名で保存 → エラー表示
✓ 1名以上で保存 → 成功、会議一覧に`planned`で表示
```

---

### 1.2 AT-002: 会議開始前の操作ガード

**目的**: `planned`状態では決定/承認操作を無効化

**対象ファイル**:
- `src/components/meeting/MeetingInspector.tsx`
- `src/lib/supabase/rpc.ts`（既存バリデーション確認）

**タスク**:
- [ ] 1.2.1 MeetingInspectorで`planned`時の操作ボタン非表示/無効化
- [ ] 1.2.2 RPC側のステータスチェック強化（既存確認）
- [ ] 1.2.3 会議内タスク操作時のmeeting_id連携確認

**検証**:
```
✓ planned状態で「決定する/承認する」が無効
✓ 「会議開始」で`in_progress`になり操作可能に
```

---

## フェーズ2: Spec導線（AT-009）

### 2.1 decided→implementedの2クリック導線

**目的**: spec_pathを開いてから実装完了を記録する導線

**対象ファイル**:
- `src/components/task/TaskInspector.tsx`
- `src/lib/hooks/useSpecTasks.ts`

**タスク**:
- [ ] 2.1.1 TaskInspectorにspec_path開くボタン追加（新タブ）
- [ ] 2.1.2 クリック時間を記録する状態管理追加
- [ ] 2.1.3 10分以内の2回目クリックでimplemented遷移
- [ ] 2.1.4 spec_path未設定時のボタン無効化

**UI仕様**:
```
[仕様を確認] ボタン
  ↓ クリック（spec_path開く + 時刻記録）
[実装完了にする] ボタン（10分以内のみ有効）
  ↓ クリック
decision_state = 'implemented'
```

**検証**:
```
✓ 1回目クリックでspec_path新タブ表示
✓ 2回目（10分以内）でimplementedに遷移
✓ spec_implementedイベント記録確認
✓ spec_path空なら押せない
```

---

## フェーズ3: 通知システム強化（AT-003, AT-004）

### 3.1 AT-003: 会議終了通知の冪等性

**目的**: 再度終了操作しても通知が重複しない

**対象ファイル**:
- `supabase/migrations/20240102_000_rpc_functions.sql`（rpc_meeting_end修正）
- 新規: `src/lib/hooks/useMeetingNotifications.ts`

**タスク**:
- [ ] 3.1.1 rpc_meeting_end内で通知生成追加
- [ ] 3.1.2 dedupe_key = `meeting_id:ended_at`で重複防止
- [ ] 3.1.3 notificationsテーブルへのupsert

**検証**:
```
✓ 「会議終了」で通知生成
✓ 再度終了操作しても通知は増えない
```

---

### 3.2 AT-004: 会議終了通知の内容

**目的**: 決定/未決の件数と並び順を正しく表示

**対象ファイル**:
- `supabase/migrations/20240102_000_rpc_functions.sql`（rpc_generate_meeting_minutes修正）

**タスク**:
- [ ] 3.2.1 未決抽出クエリの修正（ball=client優先）
- [ ] 3.2.2 期限順ソート（期限なしは最後）
- [ ] 3.2.3 通知本文のフォーマット改善

**検証**:
```
✓ 決定件数・未決件数が一致
✓ 未決は期限が近い順、期限なしは最後
✓ ball=clientの未決が優先的に上に
```

---

## フェーズ4: Edge Function（AT-011）

### 4.1 send-meeting-minutes Edge Function

**目的**: 会議終了通知をメール+アプリ内で送信

**対象ファイル**:
- 新規: `supabase/functions/send-meeting-minutes/index.ts`

**タスク**:
- [ ] 4.1.1 Edge Function基盤作成
- [ ] 4.1.2 送信先決定ロジック（参加者+担当者）
- [ ] 4.1.3 クライアント向け文面フィルタリング
- [ ] 4.1.4 in_app + email両チャネル対応
- [ ] 4.1.5 notificationsテーブルへのupsert

**送信先ロジック**:
```sql
-- 会議参加者全員
SELECT user_id FROM meeting_participants WHERE meeting_id = ?

-- + 未決タスク担当者
SELECT DISTINCT to.user_id
FROM task_owners to
JOIN tasks t ON t.id = to.task_id
WHERE t.space_id = ? AND t.status = 'considering'
```

**検証**:
```
✓ 会議終了通知が会議参加者全員に届く
✓ 参加していないが未決タスク担当者にも届く
✓ クライアントには余計な社内情報なし
```

---

## フェーズ5: Client Portal拡張

### 5.1 クライアント専用タスク一覧

**目的**: クライアントが「今日どれをチェックすればいいか」を明確に

**対象ファイル**:
- `src/app/portal/page.tsx`（新規実装）
- 新規: `src/components/portal/PortalTaskList.tsx`
- 新規: `src/components/portal/PortalTaskInspector.tsx`

**タスク**:
- [ ] 5.1.1 ポータルダッシュボード画面作成
- [ ] 5.1.2 ball=clientタスク優先表示
- [ ] 5.1.3 レビュー未承認タスク表示
- [ ] 5.1.4 内部情報フィルタリング（TP-ID等非表示）

**検証（AT-010）**:
```
✓ ball=client未決 + review未承認が上位
✓ 期限順、期限なしは最後
✓ ball=internalはクライアント「要対応」上位に出ない
```

---

### 5.2 クライアントコメント→ball自動変更

**目的**: クライアントがコメント返信したらball=internalに自動変更

**対象ファイル**:
- `src/components/task/TaskComments.tsx`
- `src/lib/hooks/useTaskComments.ts`

**タスク**:
- [ ] 5.2.1 コメント投稿時のユーザーロール判定
- [ ] 5.2.2 クライアントコメント時のball自動変更RPC呼び出し
- [ ] 5.2.3 UI側のball表示更新

---

## フェーズ6: 議事録パーサー（AT-005）

### 6.1 SPEC行からのタスク自動生成

**目的**: 議事録MDの`- [ ] SPEC(...): ...`からspecタスクを生成

**対象ファイル**:
- 新規: `src/lib/meeting/minutesParser.ts`
- `src/components/meeting/MeetingInspector.tsx`

**タスク**:
- [ ] 6.1.1 MDパーサー作成（正規表現）
- [ ] 6.1.2 SPEC行抽出ロジック
- [ ] 6.1.3 タスク生成+行末に`<!--task:tXXX-->`付与
- [ ] 6.1.4 重複生成防止（既存タグチェック）
- [ ] 6.1.5 MeetingInspector Applyタブに統合

**パース対象**:
```markdown
- [ ] SPEC(/spec/auth.md#login-flow): ログイン仕様
```
↓
```typescript
{
  type: 'spec',
  spec_path: '/spec/auth.md#login-flow',
  title: 'ログイン仕様',
  decision_state: 'considering'
}
```

**検証**:
```
✓ SPEC行からtype=specタスク生成
✓ 行末に<!--task:tXXX-->付与
✓ 再タスク化で重複なし
```

---

## 依存関係マップ

```
フェーズ1 (AT-001, AT-002)
    ↓
フェーズ2 (AT-009)
    ↓
フェーズ3 (AT-003, AT-004) ←─┐
    ↓                        │
フェーズ4 (AT-011) ──────────┘
    ↓
フェーズ5 (Client Portal)
    ↓
フェーズ6 (AT-005)
```

---

## 実行コマンド

各フェーズ完了後:
```bash
npm run lint        # ESLint
npm run type-check  # TypeScript
npm run build       # ビルド確認
npm run test        # ユニットテスト
```

---

## チェックポイント

### フェーズ1完了条件
- [ ] AT-001: クライアント参加者なし会議作成がエラー
- [ ] AT-002: planned状態で決定ボタン無効

### フェーズ2完了条件
- [ ] AT-009: 2クリックでimplemented遷移
- [ ] spec_path未設定でボタン無効

### フェーズ3完了条件
- [ ] AT-003: 通知重複なし
- [ ] AT-004: ball=client優先表示

### フェーズ4完了条件
- [ ] AT-011: 参加者+担当者に通知送信
- [ ] クライアント文面フィルタリング

### フェーズ5完了条件
- [ ] AT-010: クライアントダッシュボード優先表示
- [ ] 内部情報非表示

### フェーズ6完了条件
- [ ] AT-005: SPEC行タスク化
- [ ] 重複防止機能

---

## 次のステップ

このワークフローの実行には `/sc:implement` を使用してください。

```
/sc:implement フェーズ1から開始
```
