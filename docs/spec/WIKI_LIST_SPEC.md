# Wiki 一覧の使い勝手改善 SPEC v0.2

作成: 2026-09-08 / ストリーム: `feat/wiki-list-*`

## 目的

Wiki 一覧が「タイトル＋タグ3つ＋『○日前』」の一列表示だけで、探せない・区別がつかない・誰が書いたか分からない。
これを、タスク作業の流れの中で Wiki を引ける一覧にする。

## 段階（PR 分割）

| PR | 内容 | DB 変更 |
|----|------|---------|
| PR1 `feat/wiki-list-enhance` | 表示項目（作成者/更新者/作成日/更新日/タグ）・表示項目の選択・検索・並べ替え・タグ絞り込み・作成者絞り込み・件数 | なし |
| PR2 `feat/wiki-structure` | ピン留め（常に一番上）・フォルダ（親子）・マイルストーン紐づけ＋「フォルダ / マイルストーン別」表示切替 | あり（列追加） |
| PR3 | タスク側から同じマイルストーンの Wiki を引ける導線（TaskInspector） | なし |
| PR4 `feat/wiki-milestone-chips` | 所属マイルストーンを行にチップ表示・マイルストーン別で重複表示＋印・延べ件数 | なし |
| PR5 `feat/wiki-folders` | フォルダの作成・名前変更・削除・ドラッグ移動・フォルダ表示の並べ替え | あり（列追加） |

---

## PR1: 一覧強化（DB 変更なし）

### 純粋ロジック `src/lib/wiki/listView.ts`（テスト必須）

```ts
export type WikiSortKey = 'updated_at' | 'created_at' | 'title' | 'author'
export type WikiSortDir = 'asc' | 'desc'
export interface WikiListFilters {
  query: string          // タイトル・タグの部分一致（大文字小文字・全角半角の区別なし）
  tags: string[]         // AND 条件（選んだタグを全部持つページ）
  authorIds: string[]    // created_by が含まれる
}
export interface WikiListSort { key: WikiSortKey; dir: WikiSortDir }
export const DEFAULT_WIKI_FILTERS: WikiListFilters
export const DEFAULT_WIKI_SORT: WikiListSort   // updated_at desc

export function collectWikiTags(pages): { tag: string; count: number }[]   // 件数の多い順→名前順
export function filterWikiPages(pages, filters, getAuthorName): WikiPage[]
export function sortWikiPages(pages, sort, getAuthorName): WikiPage[]      // title/author は localeCompare('ja')
export function applyWikiListView(pages, filters, sort, getAuthorName): WikiPage[]
export function formatWikiRelativeTime(iso: string, now?: Date): string    // 既存 WikiPageRow.formatDate を移設
export function formatWikiAbsoluteTime(iso: string): string                // 'YYYY/M/D H:mm'（ローカル時刻。toISOString 禁止）
```

- `query` は `normalizeForSearch`（`toLowerCase` + NFKC）で比較する。
- `author` ソートは表示名で比較し、名前が同じなら `updated_at desc`。
- pages が空・filters が既定値のときは入力配列をそのまま返す（参照同一）。

### 表示項目の選択 `src/lib/wiki/listPrefs.ts`（テスト必須）

```ts
export type WikiListColumn = 'tags' | 'author' | 'updater' | 'created_at' | 'updated_at'
export interface WikiListPrefs { columns: WikiListColumn[]; sort: WikiListSort }
export const WIKI_LIST_PREFS_KEY = 'wiki-list-prefs:v1'
export const DEFAULT_WIKI_LIST_PREFS: WikiListPrefs   // columns = ['tags','author','updated_at'], sort = 既定
export function parseWikiListPrefs(raw: string | null): WikiListPrefs   // 壊れた JSON・未知の列は既定に戻す
export function useWikiListPrefs(): [WikiListPrefs, (p: WikiListPrefs) => void]  // localStorage、useGanttSidebarWidth と同じ作法
```

- ブラウザ単位の保存でよい（サーバー保存は不要）。
- 検索語・タグ・作成者の絞り込みは保存しない（画面を離れたら消える）。並べ替えと表示項目は保存する。

### UI

**ツールバー** `src/components/wiki/WikiListToolbar.tsx`（ヘッダの下、一覧の上）

- 左: 検索ボックス（虫眼鏡アイコン、placeholder「タイトル・タグで検索」、`data-testid="wiki-search"`）。入力は即時反映。
- 中: タグチップ列（`collectWikiTags` の上位 8 個＋「他 N 個」で展開）。クリックでトグル、選択中は `bg-indigo-50 text-indigo-700 border-indigo-200`。タグが 1 つも無ければ列ごと非表示。
- 右:
  - 「自分のページ」トグル（`useCurrentUser` の id を `authorIds` に入れる）。加えて作成者の複数選択メニュー（`useSpaceMembers(spaceId).members`）。
  - 並べ替えメニュー（ボタン表示「更新日 ↓」等）。選択肢: 更新日 / 作成日 / タイトル / 作成者。同じ項目を再選択で昇順⇄降順。
  - 表示項目メニュー（アイコン＝`Columns`）。チェックボックスで `tags / author / updater / created_at / updated_at` を ON/OFF。
- 2行目（絞り込み中のみ）: 「全 24 件中 8 件」＋「絞り込みを解除」。絞り込み無しなら「24 件」だけを薄く表示。
- メニューの開閉・外側クリックで閉じる作法は `TaskFilterMenu` と同じ（`mousedown` リスナー）。モーダルは使わない。

**行** `src/components/wiki/WikiPageRow.tsx`（差し替え）

- 1行目: タイトル（既存どおり）。
- 2行目（メタ行、`columns` に応じて出し分け、`text-xs text-gray-500`、区切りは `·`）:
  - `tags`: 既存のタグチップ（最大 3 個＋`+N`）。
  - `author`: 20px 丸アバター（`avatarUrl` があれば画像、無ければ頭文字。TaskRow の担当者アバターと同じ見た目）＋表示名。
  - `updater`: 「更新: 名前」（created_by と同じ人なら省略）。
  - `created_at`: 「作成 9/5」形式。`title` 属性に絶対時刻。
  - `updated_at`: 右端に相対時刻（既存位置）。`title` 属性に絶対時刻。
- props: `page, isSelected, onClick, columns: WikiListColumn[], getMember: (userId) => { name: string; avatarUrl: string | null } | null`
- 検索語に一致した部分の強調は不要（やらない）。

**一覧ページ** `WikiPageClient.tsx`

- `useSpaceMembers(spaceId)` と `useCurrentUser()` を追加。`getMember` は `members` から `useMemo` で Map を作って引く。
- `filters` は `useState`、`prefs` は `useWikiListPrefs`。表示配列は `useMemo(() => applyWikiListView(...))`。
- 絞り込み結果が 0 件のときは「該当するページがありません」＋「絞り込みを解除」ボタン（`EmptyState` があれば流用）。
- 既存の空状態（ページ 0 件・テンプレート導線）は変えない。
- モバイル（`md` 未満）: ツールバーは検索＋並べ替え＋表示項目だけ横並び、タグチップは横スクロール。

### 受け入れ条件（テスト）

- `listView.test.ts`: 検索（全角/半角・大文字小文字）、タグ AND、作成者、各ソートの昇降、参照同一、相対/絶対時刻（`TZ=UTC` でも日付がずれない）。
- `listPrefs.test.ts`: 既定値、壊れた JSON、未知列の除去、保存→復元。
- `WikiPageRow.test.tsx`: columns による出し分け、`title` 属性の絶対時刻、アバターのフォールバック。
- `WikiListToolbar.test.tsx`: 検索入力で `onFiltersChange`、タグチップのトグル、並べ替え再選択で昇降反転、表示項目チェック。
- 触った箇所は 80% 以上。

### やらないこと（PR1）

- DB 変更、ピン留め、フォルダ、マイルストーン、本文の抜粋表示、一覧からのタグ編集、一括操作。

---

## PR2: 構造（ピン留め・フォルダ・マイルストーン）— 設計メモ

### DB（`wiki_pages` 列追加・新規テーブルなし・RLS 変更なし）

```sql
alter table public.wiki_pages
  add column if not exists parent_page_id uuid null references public.wiki_pages(id) on delete set null,
  add column if not exists milestone_id   uuid null references public.milestones(id) on delete set null,
  add column if not exists pinned_at      timestamptz null,
  add column if not exists sort_order     int null;
create index if not exists wiki_pages_parent_idx    on public.wiki_pages(space_id, parent_page_id);
create index if not exists wiki_pages_milestone_idx on public.wiki_pages(milestone_id) where milestone_id is not null;
-- 自己参照の循環と別スペースの親を禁止する trigger（同一 org_id/space_id・祖先に自分がいない）
```

- 既存 RLS（`app_can_access_space`）で行が守られるので policy 追加は不要。
- ファイル名は `YYYYMMDDHHMMSS_wiki_structure.sql`（`date +%Y%m%d%H%M%S` で採番）。

### 挙動

- **ピン留め**: `pinned_at` が非 NULL なら、並べ替え・絞り込みに関わらず常に先頭（複数あれば `pinned_at` の古い順）。ページ情報パネルにトグル。行にピンアイコン。ホーム（`DEFAULT_WIKI_TITLE`）は自動作成時にピン留め状態で作る。
- **フォルダ**: `parent_page_id` で親子。表示切替「一覧 / フォルダ / マイルストーン別」をツールバー左端に置き、選択は `WikiListPrefs.view` に保存。フォルダ表示はインデント付きツリー（折りたたみ可、折りたたみ状態も prefs）。親の変更はページ情報パネルの「親ページ」セレクト（循環候補は除外）。ドラッグ&ドロップは PR2 ではやらない。
- **マイルストーン別**: `milestone_id` でグループ見出し（マイルストーン `order_key`→`due_date` 順、未設定は末尾「マイルストーン未設定」）。設定はページ情報パネル。
- **検索・絞り込み中**はツリー/グループを崩さず、一致した行とその祖先だけを表示。
- CLI/MCP（`packages/*/src/**/wiki.ts`）は select 列に新列を追加し、`wiki update --parent-id/--milestone-id/--pin` を足す（任意・別コミット可）。

## PR3: タスクからの導線 — 設計メモ

- `TaskInspector` の Wiki セクションに「このマイルストーンの Wiki」（`milestone_id` が同じページ）を最大 5 件、リンクで表示。
- 「仕様書」タグの扱いは既存どおり。

---

## PR4: 所属マイルストーンをタグのように見せる（v0.2 追補・2026-09-08）

### 決定（ユーザー判断）

- Wiki 一覧の既定は **`list`（一覧）** のまま。行に **所属マイルストーンをタグのように表示**する。
- **マイルストーン別**表示では、1 ページが**複数のグループに出てよい**。ただし各行に**他のマイルストーンにも出ていることが分かる印**を付ける。

理由: Wiki は「どのフェーズで使う資料か」を引く画面なので、探している場所に出てこないほうが困る。重複の見づらさは印と件数表示で消せる。

### 所属マイルストーンの決め方（union）

ページの所属マイルストーン = 次の和集合。

1. `wiki_pages.milestone_id`（ページ情報パネルで人が選んだもの。**主たる所属**）
2. `tasks.wiki_page_id = page.id` であるタスクの `tasks.milestone_id`（**タスクからの参照**。null は無視）

実データ（本番 2026-09-08 時点）: 参照されているページ 18 件のうち 10 件が 2〜4 個のマイルストーンにまたがる。マイルストーン別の延べ行数は 38。

### データ取得 `src/lib/hooks/useWikiMilestoneLinks.ts`（新規）

```ts
export function useWikiMilestoneLinks(orgId: string, spaceId: string): {
  linksByPageId: Map<string, string[]>   // pageId → milestoneId[]（重複なし）
  loading: boolean
}
```

- react-query。`queryKey: ['wikiMilestoneLinks', orgId, spaceId]`、`enabled: !!orgId && !!spaceId`（呼び出し側が `{ enabled: false }` で止められる）。
- `staleTime` は指定せず **QueryProvider の既定（2分）** に合わせる。タスクの Wiki 紐づけ / マイルストーンは人が編集したときしか変わらないため。
- クエリの返り値は **`Record<string, string[]>`（素のオブジェクト）** にする。react-query の構造共有は Map に効かず、Map を返すと再取得のたびに参照が変わって全行が再描画される。Map 化は hook 内の `useMemo` で行う。
- クエリは軽量に: `from('tasks').select('wiki_page_id, milestone_id').eq('org_id',orgId).eq('space_id',spaceId).not('wiki_page_id','is',null).not('milestone_id','is',null)`。`limit` は掛けない（列 2 つだけ）。
- 読み込み中は**共有定数の空 Map** を返す（毎レンダー新しい Map を作らない。`EMPTY_PAGES` / `EMPTY_MILESTONES` と同じ型）。所属ゼロのページにも共有の空配列（`EMPTY_MILESTONE_LIST`）を返す。
- `limit` は付けない（付けると所属が黙って欠ける）。Supabase の `max_rows` 既定 1000 に達すると同じ欠落が無言で起きるので、その規模になったらページ単位で引く形に切り替える。
- 既存 4 本（wikiPages / milestones / spaceMembers / currentUser）と**並列**。waterfall を作らない。

### 純粋ロジック `src/lib/wiki/listView.ts`

```ts
/** ページ→所属マイルストーンID[]（page.milestone_id ∪ タスク参照）。順序は milestones の並び順。 */
export function resolveWikiMilestones(
  pages: WikiPage[],
  linksByPageId: Map<string, string[]>,
  milestones: Milestone[]
): Map<string, Milestone[]>

/** マイルストーン別グループ。1ページが複数グループに出る。 */
export function groupWikiPagesByMilestone(
  pages: WikiPage[],
  milestones: Milestone[],
  milestonesByPageId: Map<string, Milestone[]>   // 追加引数
): { milestone: Milestone | null; pages: WikiPage[] }[]
```

- グループ順は従来どおり `order_key` → `due_date` → `name`。所属が 1 つも無いページは末尾「マイルストーン未設定」。
- 各グループ内の並びは従来どおり（ピン留め優先→選択中の並べ替え）。
- ページが 0 件のグループは出さない。
- `groupWikiPagesByMilestone` の第3引数は必須。既存呼び出しを更新する。

### 行 `src/components/wiki/WikiPageRow.tsx`

- 新しい表示項目 **`milestones`** を追加（`WikiListColumn` に追加）。メタ行にマイルストーンをチップで出す。
  - 見た目: `Flag` アイコン＋名前。`px-1.5 py-0.5 text-[10px] font-medium bg-indigo-50 text-indigo-ink rounded`（タグは灰色なので色で区別する）。最大 2 個＋`+N`。名前は `max-w-[8rem] truncate`、メタ行は `min-w-0 overflow-hidden`。
  - **文字色は `text-indigo-ink`（`text-indigo-700` は使わない）**。`--color-indigo-50` は `.dark` で濃紺に反転するが `--color-indigo-700` は面（`hover:bg-indigo-700` + 白文字のボタン）としても使うため反転できない。文字用に `--color-indigo-ink` を立てて `.dark` で明るい藍に反転させる。
  - 読み上げ用に囲みへ `aria-label="所属マイルストーン: フェーズ1、フェーズ3"`、`+N` に残りの名前を `title` で持たせる。
- 新しい props: `milestones?: Milestone[]`（その行の所属）、`duplicatedInOtherGroups?: number`（マイルストーン別表示で、この行が他にいくつのグループにも出ているか。0 なら出さない）。
- マイルストーン別表示のときは**チップを出さず**、代わりに `他 N 件のマイルストーンにも` を `text-[10px] text-gray-400` で出す（そのグループの見出しで所属が自明なため。重複だけを伝える）。この印は**`milestones` 列を OFF にしていても出す**（重複の理由説明なので消さない）。
- memo 化は維持。props は安定参照で渡す。

### 表示項目・保存 `src/lib/wiki/listPrefs.ts`

- `WikiListColumn` に `'milestones'` を追加。
- 既定 columns を `['tags','milestones','author','updated_at']` にする。
- **保存キーを `wiki-list-prefs:v2` に上げる**（既存利用者にも新しい既定を届けるため。表示設定なので消えても実害なし）。v1 の値は読まない。

### ツールバー `WikiListToolbar.tsx`

- 表示項目メニューに「マイルストーン」を追加。
- 件数表示: マイルストーン別表示のときだけ `18 件（延べ 38 件）` の形にする。絞り込み中は `全 N 件中 M 件（延べ K 件）`。ほかの表示では従来どおり。

### ページ情報パネル `WikiPageInspector.tsx`

- 既存の「マイルストーン」セレクト（＝主たる所属）はそのまま。
- その下に、タスクからの参照で付いているマイルストーンを**読み取り専用**で表示する: `タスクからの参照: フェーズ1・フェーズ3`（`text-[10px] text-gray-400`）。無ければ出さない。
- props に `taskLinkedMilestones?: Milestone[]` を追加し、`WikiPageClient` から渡す（新規 fetch を作らない）。

### タスク側（PR3）との整合

- `src/components/task/TaskInspector.tsx` の「このマイルストーンの Wiki」は、`pickMilestoneWikiPages` が `page.milestone_id` だけを見ている。**タスク参照由来の所属も拾うように**同じ union を使う。TaskInspector は既に `useTasks` 相当のデータを持たないので、`useWikiMilestoneLinks(task.org_id, spaceId)` を使う（一覧と同じ queryKey なのでキャッシュを共有し、往復は増えない）。

### 受け入れ条件（テスト）

- `resolveWikiMilestones`: 手動のみ / 参照のみ / 両方（重複排除）/ どちらも無し / milestones に無い id は無視 / 並び順が milestones の順 / 所属ゼロは共有の空配列。
- `isPageInMilestone`: 手動一致 / 参照一致 / 不一致 / links 未指定。
- `groupWikiPagesByMilestone`: 1 ページが複数グループに出る / 0 件グループは出さない / 未設定は末尾 / 延べ行数が期待どおり。
- `WikiPageRow`: `milestones` 列でチップが出る・2 個超で `+N` / マイルストーン別表示では `他 N 件のマイルストーンにも` が出てチップは出ない。
- `listPrefs`: v2 の既定に `milestones` が入る / v1 の保存値を読まない。
- `useWikiMilestoneLinks`: 読み込み中は同じ参照の空 Map（回帰）/ 中身が同じ再取得で Map の参照が変わらない（回帰）/ `enabled: false` で取得しない。
- `WikiPageClient` 統合: マイルストーン別で同じページが 2 グループに出る / 件数表示が「延べ」を含む。
- TaskInspector: タスク参照由来のページも「このマイルストーンの Wiki」に出る / 「他 N 件を Wiki で見る」の件数も union で数える。

### やらないこと

- DB 変更（列追加なし）。所属は毎回計算する。
- ドラッグでのマイルストーン移動、複数マイルストーンの手動割り当て（主たる所属は 1 つのまま）。

## 追補（2026-09-13）: 本文から他の物へリンクを貼る

Wiki と議事録のエディタを共通化し、本文からファイル・Wikiページ・議事録・タスクへ
リンクを貼れるようにした。仕様は `spec/DOC_LINK_SPEC.md` にまとめてある。

- 「リンクを挿入」ボタンと「/」メニューの両方から開く。部品は `src/components/editor/` に共通化
- 個別だった `WikiFileLinkPicker` / `MinutesWikiLinkPicker` は `AppLinkPicker` に統合（削除済み）
- アプリの中の画面へのリンクは**同じタブ**で開き、ブラウザの「戻る」で書いていたページに戻る
- CLI/API も同じリンクを `link` で返す

## PR5: フォルダの作成・名前変更・削除・ドラッグ移動・フォルダ表示の並べ替え（2026-09-26）

PR2 で親子関係（`parent_page_id`）は入れたが、フォルダを作る・名前を変える・削除する・
ドラッグで動かす操作が無く、フォルダ表示でも並べ替えが効かなかった（`sort_order` 固定）。
「フォルダ＝ページ」（Notion 型・本文も持てる）の方針は維持し、新規テーブルは作らない。

### DB（`wiki_pages` に列追加・RLS 変更なし）

```sql
alter table public.wiki_pages
  add column if not exists is_folder boolean not null default false;
```

- migration: `supabase/migrations/20260926072658_wiki_page_is_folder.sql`
- 既定 `false`・NOT NULL。既存行の backfill はしない（本番の既存フォルダ運用は別途）。
- `is_folder = true` のページと、`is_folder = false` でも子ページを持つページの両方を
  「フォルダ扱い」とみなす（フォルダのアイコン・フォルダ先出しの並べ替え・ドラッグの
  落とし先の判定はすべてこの2条件のORで揃える）。

### 新しいフォルダ `WikiListToolbar` + `WikiInlineCreateRow`（新規）

- ツールバーに「新しいフォルダ」ボタン（`canEdit` のときだけ・`data-testid="wiki-new-folder"`）。
- モーダルは禁止のため、押すとフォルダ表示に切り替わり、一覧の先頭にインライン入力行
  （`WikiInlineCreateRow`）が出る。Enter で確定（空・空白だけは不可）、Escape で取り消す。
- 作成は既存の `createPage` に `isFolder: true` を渡すだけ（`CreateWikiPageInput.isFolder`
  / `parentPageId` を追加）。楽観更新は既存の createPage の仕組みに乗る。

### アイコン `WikiPageRow`

- `isFolder` prop（呼び出し側が `page.is_folder === true || 子を持つか` で計算して渡す）。
  一覧・フォルダ・マイルストーン別のどの表示でも出す。
- フォルダ表示で展開中（`hasChildren && !collapsed`）は `FolderOpen`、それ以外は `Folder`
  （`data-testid="wiki-folder-icon"`、`data-open` で開閉を判別可能にしてテストする）。
- 通常ページ（フォルダでない行）はアイコンを追加しない（従来どおり）。

### 名前変更・削除 `WikiPageRow` + `WikiPageClient`

- タイトルのダブルクリックでその場編集（`canEdit` かつ `onRename` があるときだけ）。
  Enter で確定・Escape/外側クリックで取り消し・空では確定しない。
- `isFolder && canEdit` の行だけ「…」メニュー（`DotsThree`）を出し、「名前を変更」
  （ダブルクリックと同じ編集状態を開く）と「削除」を選べる。
- 削除は確認をはさむ（#992 と同じ `useConfirmDialog`）。文言:
  「フォルダを削除します。中のページは1つ上の階層に移ります。この操作は取り消せません。」
- 削除の手順: `childrenReparentTargets(pages, folderId)`（純粋関数・`listView.ts`）で
  直下の子の新しい親（削除するフォルダの親。無ければ `null`）を求め、
  子を1件ずつ `updatePage({ parent_page_id })` → 全部終わってから `deletePage(folderId)`。
  孫以下は触らない（直下の子だけが1段上がる）。

### ドラッグでの移動（フォルダ表示・デスクトップ`md`以上のみ）

- HTML5 の drag and drop のみ（外部ライブラリなし）。`WikiPageRow` に
  `isDraggable` / `onDragStartPage` / `onDragOverPage` / `onDropPage` / `onDragEndPage` /
  `dropHighlight`（`'valid' | 'invalid'`）を追加。
- 落とせるかどうかは `isValidWikiDropTarget(pages, draggedId, targetId)`（純粋関数）で判定:
  - `targetId === null`（一覧先頭に出る「一番上の階層へ」の特別な落とし先）は常に許可。
  - 自分自身の上、自分の子孫（`descendantIds` で判定・循環防止）の中へは不可。
  - 落とし先は「フォルダ扱い」の行のみ（`is_folder` または子を持つ）。
- 落とせる先は破線＋`bg-indigo-50`、落とせない先は行を薄くして `cursor-not-allowed`。
- 移動は `updatePage(draggedId, { parent_page_id: targetId })`（楽観更新は既存の
  `updatePage` に乗る。失敗時は自動でロールバックされ、追加のエラー表示はしていない）。
- モバイル（`md` 未満）は今までどおりページ情報パネルの「親ページ」セレクトで移動する
  （変更なし）。

### フォルダ表示の並べ替え `src/lib/wiki/listView.ts`

- `buildWikiTree(pages, sort = DEFAULT_WIKI_SORT, getAuthorName)` に変更（第2・3引数を追加）。
  各階層の兄弟ごとに **フォルダ（`is_folder` または子あり）を先、ページを後** にし、
  それぞれの中を `sort`（ツールバーの並べ替え。既存の `prefs.sort` をそのまま使う）で並べる。
- 旧来の `sort_order` 列は**もう見ない**（並べ替えは常に選ばれているため）。列自体は
  残っているが、フォルダ表示の並び順には使わない。
- ピン留めは今までどおり一番上の階層だけで最優先（`WikiPageClient` 側で根ノードを
  ピン留め優先に並べ直してから `buildWikiTree` の結果を使う。子の並びはそのまま）。
- 絞り込み（祖先だけ残す `pruneWikiTreeToMatches`）とは独立に効く（絞り込み後の配列に
  対して並べ替え＋フォルダ先出しを行う）。

### 純粋ロジック（テスト必須・`src/lib/wiki/listView.ts`）

```ts
/** フォルダ削除時、直下の子ページの新しい parent_page_id（フォルダの親。無ければ null）。 */
export function childrenReparentTargets(
  pages: WikiPage[],
  folderId: string
): { id: string; newParentId: string | null }[]

/** ドラッグ移動の可否。target が null なら常に許可（一番上の階層へ）。 */
export function isValidWikiDropTarget(
  pages: WikiPage[],
  draggedId: string,
  targetId: string | null
): boolean
```

### 受け入れ条件（テスト）

- `listView.test.ts`: `buildWikiTree` のフォルダ先出し＋選んだ並べ替えの反映（既存の
  `sort_order` 前提のテストは新しい挙動に更新）、`childrenReparentTargets`（子あり/根/子なし）、
  `isValidWikiDropTarget`（root常に可・自分自身不可・子孫不可・非フォルダ不可・存在しないid不可）。
- `WikiPageRow.test.tsx`: フォルダアイコンの出し分け（`isFolder`・展開/折りたたみ）、
  ダブルクリックでの編集開始・Enter確定・Escape取消・空は不可、フォルダの「…」メニューから
  削除、ドラッグの各コールバック・`dropHighlight` の見た目。
- `WikiListToolbar.test.tsx`: `canEdit` のときだけ「新しいフォルダ」ボタンが出て
  `onCreateFolder` が呼ばれる。
- `WikiInlineCreateRow.test.tsx`: Enter確定・空/空白は不可・Escape取消。
- `WikiPageClient.folders.test.tsx`: ボタン押下→フォルダ表示へ切替＋インライン入力、
  確定で `createPage({ isFolder: true })`、名前変更で `updatePage`、削除の確認→子の
  付け替え→`deletePage` の順、ドラッグでの移動・「一番上の階層へ」・子孫への移動不可、
  一覧表示ではドラッグ不可。
- migration 回帰: `wikiPageIsFolderMigration.test.ts`（列追加が冪等・RLS/トリガー/GRANT
  を触らない）。

### やらないこと（PR5）

- フォルダの中にさらに「この中に新しいフォルダ」を作る専用導線（親ページ選択やドラッグで
  代替可能なため見送り）。
- 削除時の一括確認（複数フォルダの同時削除）。
- モバイルでのドラッグ移動（`md` 未満は従来どおり「親ページ」セレクトのみ）。
