# ポータルUX改善仕様書

**Version**: 1.0
**Status**: Draft
**Priority**: HIGH
**Estimated Effort**: 2-3日
**Branches**: `fix/portal-alert-to-toast`, `fix/portal-invite-expiry`, `fix/portal-double-submit`

---

## 1. 目的

クライアントポータルのUX課題を修正し、ポータル放棄率を低減する。
プリモーテム分析で特定された以下の3課題を解決する。

## 2. スコープ

### 2.1 alert() → トースト通知への置換

**Branch**: `fix/portal-alert-to-toast`

#### 現状の問題
- ポータル内の全エラー/成功通知が`alert()`で表示されている
- `alert()`はモーダルでブロッキングし、他の操作を一切受け付けない
- スマホでは画面全体がブロックされ、UXが最悪
- 技術用語（「Internal server error」等）がそのまま表示される

#### 対象ファイル

| ファイル | alert()使用箇所 | 置換内容 |
|---------|----------------|---------|
| `src/app/portal/PortalDashboardClient.tsx` | 承認/修正依頼のエラー、409 Conflict、403 Forbidden、401 Session、ネットワークエラー | トースト通知 |
| `src/app/portal/tasks/PortalTasksClient.tsx` | タスク状態変更通知（409）、コメント入力バリデーション | トースト通知 |
| `src/app/portal/task/[taskId]/PortalTaskDetailClient.tsx` | 修正依頼時の入力バリデーション（`alert('修正内容を入力してください')`） | トースト通知（`toast.warning('修正内容を入力してください')`） |

#### 技術仕様

**sonner（トーストライブラリ）の使用**:
- `<Toaster />` は `src/app/layout.tsx`（RootLayout）に既に配置済み（`position="bottom-right"`, `richColors`, `duration={3000}`）
- **PortalShellへの `<Toaster />` 追加は不要**（二重表示リスクを回避）
- ポータルコンポーネントからは `import { toast } from 'sonner'` で直接使用するのみ

```typescript
// Before
alert('セッションが切れました。再ログインしてください。')

// After
import { toast } from 'sonner'
toast.error('セッションが切れました。再度アクセスしてください。')
```

**メッセージのクライアント向け言い換え**:

| 現状 | 置換後 |
|------|--------|
| `alert(errorMessage)` (409) | `toast.error('他のユーザーが先に操作しました。画面を更新します。')` + router.refresh() |
| `alert('このタスクへのアクセス権限がありません')` (403) | `toast.error('このタスクにはアクセスできません。')` |
| `alert('セッションが切れました...')` (401) | `toast.error('セッションが切れました。再度アクセスしてください。')` |
| `alert('承認に失敗しました')` (その他) | `toast.error('操作に失敗しました。しばらくしてからお試しください。')` |

**Toaster配置**: RootLayout（`src/app/layout.tsx`）の既存 `<Toaster />` を共通利用する。PortalShellへの個別追加は行わない。

> **注意**: ポータル固有のトースト位置（`top-right`等）を使いたい場合は、RootLayout側の設定を変更するか、Toasterの`toastOptions`でポータル用クラスを付与する方式を検討する。PortalShellへの `<Toaster />` 二重配置は禁止。

#### 制約
- sonnerは既にpackage.jsonに含まれている（追加インストール不要）
- エラーメッセージに技術用語を含めない
- トースト表示時間: 5秒（デフォルト）
- 位置: 画面右上（`position="top-right"`）

---

### 2.2 招待リンク有効期限の延長

**Branch**: `fix/portal-invite-expiry`

#### 現状の問題
- 招待リンクは30日で失効する設計
- 長期プロジェクトでクライアントが突然アクセスできなくなる
- パスワードレス認証のため、再ログイン手段がない

#### 技術仕様

**対象**: 招待トークン生成ロジック（RPC + API + メール文面）

#### 変更点一覧

| 変更対象 | ファイル | 変更内容 |
|---------|---------|---------|
| RPC関数 | `supabase/migrations/20240103_000_auth_billing.sql` 内 `rpc_create_invite` | `interval '30 days'` → `interval '90 days'`（2箇所: INSERT文とRETURN文） |
| トークン検証API | `src/app/api/invites/[token]/route.ts` | 有効期限切れ時のレスポンスメッセージを改善 |
| 招待メール文面 | `src/lib/email/index.ts` (`sendInviteEmail`) | メール本文中の期限表示を確認・修正（`expiresAt`パラメータから算出される日付表示が正しいことを検証） |
| DDLマイグレーション | `docs/db/` 配下に新規SQLファイル追加 | `rpc_create_invite` のCREATE OR REPLACE文（90日版） |

1. 招待トークンの有効期限を **30日 → 90日** に延長
2. `rpc_create_invite` 内の `now() + interval '30 days'` を `now() + interval '90 days'` に変更（INSERT文・RETURN文の2箇所）
3. 招待メール文面の期限表示が90日後の日付を正しく反映することを確認
4. 有効期限切れの表示メッセージを改善

**有効期限切れ時のUI改善**:
```
現状: エラーページまたは空白
改善: 「招待リンクの有効期限が切れました。プロジェクト担当者に再招待を依頼してください。」
      + 「メールで連絡する」ボタン（mailto:リンク、宛先は空）
```

#### 制約
- 既存の有効な招待リンクには影響を与えない
- DBマイグレーションが必要な場合はSQLファイルを`docs/db/`に配置
- セキュリティ上、無期限は避ける（90日を上限）

---

### 2.3 ポータル承認の二重送信防止

**Branch**: `fix/portal-double-submit`

#### 現状の問題
- 承認/修正依頼ボタンに二重送信防止がない
- ネットワーク遅延時にユーザーがボタンを連打 → 複数リクエスト送信
- 2回目以降は409 Conflictを返すが、UIには反映されず混乱

#### 技術仕様

**対象ファイル**: `src/app/portal/PortalDashboardClient.tsx`

```typescript
// 各アクションハンドラにタスク単位のisSubmitting制御を追加
// submittingTaskIdは「現在送信中のタスクID」を保持
// → 同一タスクの連打のみブロックし、他タスクの操作は許可する
const [submittingTaskId, setSubmittingTaskId] = useState<string | null>(null)

const handleApprove = async (taskId: string) => {
  if (submittingTaskId === taskId) return // 同一タスクのみブロック
  setSubmittingTaskId(taskId)
  try {
    // 既存の承認ロジック
  } finally {
    setSubmittingTaskId(null)
  }
}
```

> **重要**: `submittingTaskId` による制御は「同一タスクのみブロック」とする。`if (submittingTaskId) return` のようにグローバルにブロックすると、一覧画面で別タスクへの操作まで阻害されるため不可。

**UI変更**:
- 送信中は**対象タスクのボタンのみ**disabled + スピナー表示
- ボタンテキストを「承認中...」「送信中...」に変更
- `aria-busy="true"` でアクセシビリティ対応
- 他タスクのボタンは通常通り操作可能

```tsx
<button
  onClick={() => handleApprove(task.id)}
  disabled={submittingTaskId === task.id}
  aria-busy={submittingTaskId === task.id}
  className={submittingTaskId === task.id ? 'opacity-50 cursor-not-allowed' : ''}
>
  {submittingTaskId === task.id ? '承認中...' : '承認'}
</button>
```

#### 制約
- 既存の承認ロジックの動作を変えない
- disabled状態のスタイルは既存デザインシステムに合わせる
- 修正依頼ボタンにも同様に適用
- **二重送信防止は同一タスクのみブロック**（他タスクの操作は許可）

---

## 3. 検証方法

### alert() → トースト
- [ ] 全ポータルページでalert()が使われていないこと（grep確認: `PortalDashboardClient.tsx`, `PortalTasksClient.tsx`, `PortalTaskDetailClient.tsx`）
- [ ] エラー発生時にトースト通知が表示されること
- [ ] トーストが自動消滅すること（RootLayoutの`duration={3000}`設定に従う）
- [ ] 技術用語がユーザーに表示されないこと
- [ ] `<Toaster />`がPortalShellに追加されていないこと（RootLayout共通利用の確認）

### 招待リンク
- [ ] 新規招待の有効期限が90日になること（`rpc_create_invite`のINTERVAL確認）
- [ ] 招待メール文面に90日後の正しい期限日が表示されること
- [ ] 期限切れ時に適切なメッセージが表示されること
- [ ] 既存の有効な招待が影響を受けないこと

### 二重送信防止
- [ ] 承認ボタンを連打しても1回のみリクエストされること
- [ ] 送信中にスピナーが表示されること
- [ ] 送信完了後にボタンが再度有効になること
- [ ] 修正依頼ボタンにも同様に機能すること
- [ ] あるタスクの送信中に別タスクのボタンが操作可能であること（同一タスクのみブロック）
