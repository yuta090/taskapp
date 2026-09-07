# ファイル→表ビュー仕様（DATA_TABLE_VIEW）v0.1

> **Status**: v0.1 実装済み（読み取り専用）／v1.0（リッチ編集）は方針のみ
> **Created**: 2026-09-07

## 背景

プロジェクトの成果物には「タスク」でも「文書」でもない**表**が出る（例: 営業先リスト 262社×16列、標準機能一覧 49件×7列）。
これらは Google スプレッドシート／Salesforce が正本で、TaskApp に**表データとして取り込む必然性は薄い**。
一方で「共有されたファイルを、ダウンロードせずに TaskApp の中でそのまま見たい」需要はある。

v0.1 は**アップロード済みの CSV/TSV を TaskApp 内で表として見る**（編集なし）。
将来（v1.0）は**表をリッチに編集する**機能を作る方針（下記）。v0.1 はその土台になるよう、
表データのモデルと変換を UI から分離している。

## v0.1 スコープ（実装済み）

| 項目 | 内容 |
|------|------|
| 対象ファイル | 拡張子 `.csv` / `.tsv`、または MIME `text/csv` / `text/tab-separated-values`（`isTabularFile`） |
| 上限 | 4MB（`MAX_TABLE_FILE_BYTES`）。Vercel の関数応答上限 4.5MB より下。超えると 413 → 「ダウンロードして開いてください」。DB の申告値と取り出した実サイズの両方で確認 |
| 文字コード | UTF-8（BOM 可）→ 失敗時 Shift_JIS にフォールバック（`decodeTextBuffer`）。Shift_JIS で読んだ場合はヘッダに小さく表示 |
| 区切り | カンマ／タブ／セミコロンを1行目から自動判定 |
| 引用 | RFC 4180（引用符内のカンマ・改行・`""`） |
| 不揃いな行 | 短い行は空セル埋め、長い行は見出しを「列N」で補う。空見出しも「列N」 |
| 空行 | 全セル空の行は捨てる |
| 並べ替え | 見出しクリックで 昇順 → 降順 → 解除。数値列は数として比較（桁区切りカンマ許容）、空セルは常に最後 |
| 絞り込み | 検索欄。全セル対象・大文字小文字無視・空白区切りは AND。件数は「n件 / 全m件」 |
| 表示 | 見出し上固定・行番号左固定（元の行番号を保持）・行仮想化（@tanstack/react-virtual） |
| 場所 | `/{orgId}/project/{spaceId}/files/{fileId}`（Main ペイン。Inspector は使わない） |
| 導線 | ファイル一覧の CSV/TSV 行: ファイル名がリンク＋「表で見る」アイコン |
| CLI | `agentpm file upload --file ./list.csv` でアップロード可（CLI 0.4.0+、`docs/spec/CLI_SPEC.md` File 節）。完了結果の `tablePath` が表ビューのパス |
| 対象外 | クライアント portal（v0.1 は内部画面のみ）、`.xlsx`、編集、列の幅変更・固定・非表示 |

## 構成

```
src/lib/table/
  parseDelimited.ts   # CSV/TSV → TableData { columns, rows }（純関数・v1.0 の編集モデルでもある）
  decodeText.ts       # ArrayBuffer → 文字列（UTF-8 → Shift_JIS フォールバック）
  tableModel.ts       # sortRows / filterRows / isTabularFile / MAX_TABLE_FILE_BYTES
src/lib/hooks/useFileTable.ts            # fetch → decode → parse（react-query, staleTime 10分, 永続キャッシュ対象外）
src/components/table/DataTableView.tsx   # 読み取り専用グリッド（表示専用。編集は別コンポーネントに切り出す）
src/app/api/files/[id]/content/route.ts  # 生バイト返却（RLS で行を確認 → service role で download）
src/app/(internal)/[orgId]/project/[spaceId]/files/[fileId]/  # ページ
```

### API: `GET /api/files/[id]/content`

| 条件 | 応答 |
|------|------|
| 未ログイン | 401 |
| id が UUID でない | 400 |
| RLS で見えない／存在しない／`status != 'ready'` | 404 |
| 表として扱えないファイル | 415 |
| `size_bytes > 4MB`（または取り出した実サイズが超過） | 413（申告値で弾けた場合は実バイトを取りにいかない） |
| 成功 | 200 `text/plain`（CDN 圧縮を効かせるため。解釈はブラウザ側）、stream で返す、`X-Content-Type-Options: nosniff`、`Cache-Control: private, max-age=3600` |

`download` route（署名URLへ 302）を使わず自分で返すのは、ブラウザから `fetch` で読む際に Storage 側の CORS に依存させないため。
文字コード判定と表への変換は**ブラウザ側**で行う（サーバーは生バイトを返すだけ）。

### キャッシュ

- `["fileTable", fileId]`。同じ id の中身は変わらない（差し替えは別 id）ため staleTime 10分。変換済みの表は数MB の CSV で 100MB 級のメモリになるため gcTime 5分。
- 変換済みの表は大きくなり得るため **IDB 永続化の対象外**（`QueryProvider.shouldDehydrateQuery`）。
- ファイル名・サイズは一覧 `['files', spaceId]` のキャッシュから引く（一覧→表の遷移で追加の待ちなし）。

## v1.0 方針: 表をリッチに編集する（未実装・方針のみ）

ユーザー決定（2026-09-07）: **今後、表をリッチに編集できる機能は作る**。

- **編集モデル**は v0.1 の `TableData` をそのまま使う。`parseDelimited` の逆変換 `serializeDelimited`（CSV 書き出し）を `src/lib/table/` に追加する。
- **表示と編集を分ける**: `DataTableView` は表示専用のまま。編集は `DataTableEditor`（仮）として別に作り、セル編集・行追加/削除・列追加/名前変更・Undo を持たせる。
- **保存先の候補**（要判断。Fable 裁定対象になり得る）:
  1. **ファイルへ書き戻す**（新しい `files` 行＝新 id として保存。履歴＝ファイル版）。DDL 変更なし・最小。
  2. **表を独自エンティティにする**（`space_tables` / `space_table_rows` 等）。列型・並び順・クライアント可視を列単位で持てるが、DDL・RLS 新規設計が必要。
  - v1.0 の第一歩は **1（ファイルへ書き戻し）** を推奨。2 は「タスクと行を紐づける」「列単位の見せ分け」の需要が実際に出てから。
- **Optimistic update 必須・保存ボタンなし**（UI Rules）。セル確定ごとに保存キューへ。
- **同時編集**は v1.0 では扱わない（最後の保存が勝つ）。必要になったら `wiki_pages` の版管理に倣う。
- portal（クライアント）側は**閲覧のみ**を先に開放し、編集は内部限定から始める。

## テスト

- `src/__tests__/lib/table/*.test.ts`（parse / decode / sort / filter / 判定）
- `src/__tests__/lib/hooks/useFileTable.test.tsx`
- `src/__tests__/components/table/DataTableView.test.tsx`
- `src/__tests__/app/files/FileTablePageClient.test.tsx`
- `src/__tests__/components/files/FilesPageClient.test.tsx`（表で見る導線）
- `src/__tests__/app/api/files/[id]/content/route.test.ts`
