# 文書の中のリンク（Wiki・議事録）v1.0

Wiki と議事録の本文から、AgentPM の中の物（ファイル・Wikiページ・議事録・タスク）を
参照できるようにするための仕様。画面（エディタ）と CLI/API の両方から同じ形で貼れる。

- 状態: 実装済み（2026-09-13）
- 関連: `WIKI_LIST_SPEC.md`（Wiki 一覧）・`CLI_SPEC.md`（CLI 全体）・`MEETING_MINUTES_TEMPLATE.md`

---

## 1. リンクの形（単一情報源）

| 参照する物 | リンク | 押したときに起きること |
|---|---|---|
| タスク | `/{orgId}/project/{spaceId}?task={taskId}` | タスク一覧が開き、右にそのタスクの詳細が出る |
| Wikiページ | `/{orgId}/project/{spaceId}/wiki?page={pageId}` | その Wiki ページが開く |
| 議事録（会議） | `/{orgId}/project/{spaceId}/meetings?meeting={meetingId}` | その会議の議事録が開く |
| ファイル | `/api/files/{fileId}/download` | ダウンロードが始まる（画面は変わらない） |

組み立てる場所は2つだけで、どちらも同じ文字列を作る。

- 画面: `src/lib/navigation/appLinks.ts`
- CLI/API: `packages/mcp-server/src/lib/appLinks.ts`

パッケージをまたぐため同じモジュールを共有できない。**綴りがずれると押しても開かない**ので、
`src/__tests__/lib/navigation/appLinks.crossPackage.test.ts` が両者の出力を突き合わせる。
片方だけ変えるとこのテストが落ちる。

## 2. 画面から貼る

Wiki・議事録のどちらも、本文の下の「リンクを挿入」ボタン、または「/」メニューの
「リンクを挿入」から開く。部品は共通（`src/components/editor/`）。

- 種別（ファイル / Wiki / 議事録 / タスク）を切り替え、名前で探す
- 候補は8件まで。超えたぶんは「ほか N 件。言葉を足すと絞り込めます」
- タスクは頭に通し番号（`TP-42`）を付ける
- 社内のみのファイルを選ぶと「相手先には開けません」と出し、パネルを開いたままにする
- 選ばれている種別のぶんしかデータを取りに行かない（種別ごとに子コンポーネントを分ける）
- パネルは上下の空きを測って、入るほうに出す

**議事録の制約**: 議事録は Markdown が正本なので、`serializeMinutesBlocks` が書き出せる
ブロックしか入れられない（`ALLOWED_SLASH_MENU_ITEMS`）。リンクはインラインなので影響しない。

## 3. 押したときの動き

| リンクの種類 | 開き方 | 「戻る」 |
|---|---|---|
| アプリの中の画面 | **同じタブ**で移動し、履歴に積む | 書いていたページに戻る |
| ファイルのダウンロード | 今までどおり（別タブでダウンロードが始まる） | — |
| 外部のサイト | 別タブ | — |
| Cmd/Ctrl/Shift/Alt ＋クリック、中クリック | 邪魔しない（ブラウザに任せる） | — |

実装は `src/components/editor/inAppLinkNavigation.ts`。

- **DOM に直接、capture 側で受ける**。BlockNote（ProseMirror）は `mousedown` から
  リンクを開く処理を始めるので、`click` だけ止めても別タブが開く。
  `mousedown` / `mouseup` / `click` の3つを止める
- 移る前に自動保存を確定させる（`onBeforeNavigate`）。**保存できないときは移らない**。
  書きかけを消すより、その場に留まって画面の理由を読んでもらう
- 相手先ポータル（読み取り専用・プロジェクトが分からない）では横取りしない。
  社内の画面へ連れて行っても相手先は開けないため

本文中のリンクは、用途が分かるよう印を変える（`globals.css`）。

- アプリの中の画面 → `→`
- ファイルのダウンロード → `⤓`
- 外部のサイト → `↗`（後ろに付く）

## 4. CLI / API から貼る

タスク・Wikiページ・議事録・ファイルの**一覧と詳細に `link` が入る**。値は第1章の表と同じ。

```bash
agentpm task list --json      # 各タスクに link
agentpm task get --json --task-id <id>
agentpm wiki list --json      # 各ページに link
agentpm wiki get --json --page-id <id>
agentpm meeting list --json   # 各会議に link
agentpm meeting get --json --meeting-id <id>
agentpm file list --json      # 各ファイルに link（= downloadPath と同じ値）
```

貼るときは Markdown で `[名前](link)` と書き、`wiki create` / `wiki update` /
`meeting minutes` に渡す。**`link` の値をそのまま使い、自分で URL を組み立てない。**

| 並びの決まり | 理由 |
|---|---|
| Wiki・議事録・ファイルは `link` を**先頭**に置く | CLI の表は先頭8列しか出さない |
| タスクは `link` を**末尾**に置く | 先頭8列は `number` 始まりの並びが決まっており、押し出される列が出る |

`file list` の `downloadPath` は今までどおり残す（`link` と同じ値）。名前をそろえたのは、
4種類のどれでも同じキーで取れるようにするため。

AI 向けの手引きは `src/lib/cli-skill.ts`（`agentpm` スキル）の
「Wiki や議事録に、アプリの中の物へのリンクを貼る」に入っている。

## 5. 変えるときの手順

1. `src/lib/navigation/appLinks.ts` と `packages/mcp-server/src/lib/appLinks.ts` を**両方**直す
2. `appLinks.crossPackage.test.ts` を通す
3. 受け取る側（`WikiPageClient` の `?page=`、`TasksPageClient` の `?task=`、
   `MeetingsPageClient` の `?meeting=`）も同じ綴りか確かめる
4. CLI の説明（`src/lib/cli-manifest.ts`）と手引き（`src/lib/cli-skill.ts`）を直す

---

## 6. タスクの説明文の中のリンク（v1.1・2026-09-13）

タスクの説明文は Markdown ではなく**ただの文字**として表示する。CLI が返す `link` を書いても
押せなかったので、**文字の中の URL だけを押せるようにする**（説明欄をエディタにはしない）。

- 部品: `src/components/shared/LinkifiedText.tsx`／拾う所の判定: `src/lib/navigation/linkifyText.ts`
- 出している場所: `TaskInspector`（社内・編集できる側と読み取り専用の2か所）、
  `PortalTaskInspector`、`PortalTaskDetailClient`（相手先）

### 拾う形（拾いすぎない）

アプリの中のリンクは **`appLinks.ts` が作る形だけ**を認める。`9/13` のような日付や `A/B` まで
リンクになると事故るため。形を増やすときは `appLinks.ts` と両方そろえる。

| 書いたもの | どうなるか |
|---|---|
| `/{orgId}/project/{spaceId}`（＋ `?task=` `/wiki?page=` `/meetings?meeting=`） | 同じタブで開く（`next/link`・戻るで戻れる） |
| `/api/files/{fileId}/download` | 新しいタブ（ダウンロード） |
| `https://…` | 新しいタブ（`rel="noopener noreferrer"`） |
| `/foo/bar`・`9/13`・`javascript:…`・`//example.com` | 押せない（ただの文字） |

URL の後ろの句読点・閉じ括弧はリンクに含めない（`（https://example.com/a）。` で括弧まで飲まない）。

### 決めごと

- **相手先ポータルでは `inApp={false}`**。社内の画面へのリンクは押せるようにしない
  （相手先は開けない。押して弾かれるより、ただの文字のほうがよい）。外部サイトは押せる
- リンクを押したときは **`stopPropagation`**。説明文の囲みは押すと編集に入る作りなので、
  伝わると「リンク先へ行きながら編集も開く」ことになる
- **CLI から書くときは Markdown にしない**。`[名前](link)` と書くと記号がそのまま出る。
  `link` の値だけを書く（`src/lib/cli-skill.ts` に明記）
