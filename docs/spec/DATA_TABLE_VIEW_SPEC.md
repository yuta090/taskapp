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
| 対象外 | クライアント portal（v0.1 は内部画面のみ）、`.xlsx`、列の固定・非表示（**編集と列の幅変更は v1.0 で対応**） |

## 構成

```
src/lib/table/
  parseDelimited.ts   # CSV/TSV → TableData { columns, rows }（純関数・v1.0 の編集モデルでもある）
  decodeText.ts       # ArrayBuffer → 文字列（UTF-8 → Shift_JIS フォールバック）
  tableModel.ts       # sortRows / filterRows / isTabularFile / MAX_TABLE_FILE_BYTES
src/lib/hooks/useFileTable.ts            # fetch → decode → parse（react-query, staleTime 10分, 永続キャッシュ対象外）
src/components/table/DataTableEditor.tsx # グリッド本体（v1.0 で編集に対応。`editable=false` が読み取り専用）
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

- `["fileTable", fileId]`。staleTime 10分・gcTime 5分（変換済みの表は数MB の CSV で 100MB 級のメモリになる）。v1.0 の編集で**同じ id のまま中身が変わる**ようになったが、自分の保存はキャッシュをその場で差し替える（`useSaveFileTable`）ので取り直しは要らない。ほかの人の編集は保存時の版の確認（409）で気づける。
- GET の `Cache-Control` は `private, no-cache`（直した直後の再読み込みで、ブラウザが古い中身を出さないようにするため）。
- 変換済みの表は大きくなり得るため **IDB 永続化の対象外**（`QueryProvider.shouldDehydrateQuery`）。
- ファイル名・サイズは一覧 `['files', spaceId]` のキャッシュから引く（一覧→表の遷移で追加の待ちなし）。

## v1.0 スコープ: 表を直す（実装済み）

ユーザー決定（2026-09-17）: **直したら、同じファイルを書き換える**（新しいファイルは作らない）。
スプレッドシートから取り込んだ CSV を TaskApp の中で直す、という使い方に一番近いため。

| 項目 | 内容 |
|------|------|
| 直せる人 | **社内メンバーだけ**（`useCanEditSpace` の `canEdit`／API 側でも client・vendor は 403）。閲覧者・相手先は**同じグリッドを `editable=false`** で見るだけ |
| できること | セルの書き換え、行の追加（**表の一番下**）・削除、列の追加・削除（確認あり）、見出しの名前の変更 |
| 見せ方 | 列の幅は見出しの境目をドラッグ（ダブルクリックで自動幅に戻す・下限 120px／上限 800px）。「折り返して表示」で長いセルを同じ列幅のまま全文表示（既定はオフ＝1行で省略）。どちらも**見た目だけ**で、ファイルの中身も保存も起こさない |
| 列の削除ボタン | 取り消せない操作なので、見出しにマウスを乗せたときだけ出す（`md` 未満はホバーが無いので常時表示） |
| 保存 | **保存ボタンなし**。入力が止まって 1.2 秒で自動保存。保存は同時に1本だけで、通信中に来た分は最後の1つだけ積む |
| 保存先 | **同じ `files` 行・同じ `storage_path` を上書き**。id もダウンロードリンクも変わらない。版の履歴は残らない |
| 文字コード | 保存は必ず **BOM 付き UTF-8**（Excel でダブルクリックしても化けない）。元が Shift_JIS のファイルは UTF-8 になる |
| 区切り | 読み込んだときの区切りをそのまま使う（`.tsv` はタブのまま） |
| 競合 | 保存に「基準の版」(`files.updated_at`) を添える。ズレていれば 409 → 帯を出して**自動保存を止める**。「書きかけをコピー」「最新を読み込む」で逃がす |
| 並べ替え・絞り込み | 編集中も使える。書き込む先は**行の配列そのもの**から引く（見えている順番の番号では書かない） |
| 対象外 | 同時編集（最後の保存が勝つ）、取り消し（Undo）、セルの結合・数式、`.xlsx`、クライアント portal での編集、列の固定・非表示、幅の保存（開き直すと自動幅に戻る） |

### API: `PUT /api/files/[id]/content`

本文は CSV/TSV の生バイト（ブラウザ側で組み立てた BOM 付き UTF-8）。ヘッダ `X-Base-Updated-At` に基準の版を載せる。

| 条件 | 応答 |
|------|------|
| 未ログイン | 401 |
| id が UUID でない／`X-Base-Updated-At` 無し／本文が空 | 400 |
| 本文が 4MB 超 | 413 |
| RLS で見えない／`status != 'ready'` | 404 |
| 表として扱えないファイル | 415 |
| client・vendor（相手先） | 403 |
| 基準の版がズレている（更新 0 行） | 409 |
| 成功 | 200 `{ updatedAt, sizeBytes }` |

**順番は DB が先・Storage が後**。逆にすると、競合に気づく前に相手のバイトを上書きしてしまう。
Storage の書き込みだけ失敗したときは 500 に `updatedAt` を添えて返し、同じ基準でのやり直しが必ず 409 になるのを防ぐ。

### 構成（v1.0 で足したもの）

```
src/lib/table/
  serializeDelimited.ts   # TableData → CSV/TSV テキスト（parseDelimited の逆・往復をテストで保証）
  editModel.ts            # setCell / insertRow / deleteRow / insertColumn / deleteColumn / renameColumn（純関数）
src/lib/hooks/useSaveFileTable.ts        # PUT・競合(409)の判定・表キャッシュの差し替え
src/components/table/DataTableEditor.tsx # グリッド本体（editable で「見るだけ」と「直せる」を切り替え）
                                         #   ※ 読み取り専用の DataTableView は役目を終えたので削除した。
                                         #     役割が決まってから出し分けると、先に表が届いたときに
                                         #     グリッドを一度作って捨てることになる（page-perf 指摘）
```

## テスト

- `src/__tests__/lib/table/*.test.ts`（parse / decode / sort / filter / 判定 / 書き出し / 編集操作）
- `src/__tests__/lib/hooks/useFileTable.test.tsx`・`useSaveFileTable.test.tsx`
- `src/__tests__/components/table/DataTableView.test.tsx`・`DataTableEditor.test.tsx`
- `src/__tests__/app/files/FileTablePageClient.test.tsx`（自動保存・競合の帯）
- `src/__tests__/components/files/FilesPageClient.test.tsx`（表で見る導線）
- `src/__tests__/app/api/files/[id]/content/route.test.ts`・`put.test.ts`
