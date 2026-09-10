# コマンドライン（agentpm）

`agentpm` は、パソコンの黒い画面（ターミナル）から AgentPM を操作する道具です。**まとまった数のタスクを一気に登録したい**、**手元のファイルをまとめて送りたい**ときや、**AI（Claude Code など）に AgentPM を操作させたい**ときに使います。

> ふだんの操作に必要なものではありません。**数十件〜数百件をまとめて扱うとき**や、**AI に任せたいとき**に使う道具です。画面からの操作で足りている方は読み飛ばして構いません。

---

## 最初の1回だけの設定

同じ手順は、APIキーを発行する画面（「設定 → **APIキー**」／「プロジェクト設定 → **API設定**」）にも出ていて、コマンドをそのままコピーできます。

### 1. インストールする

ターミナル（Mac は「ターミナル」アプリ）で次を実行します。**Node.js 18 以上**が必要です（入っていなければ [nodejs.org](https://nodejs.org/) から入れてください）。

```bash
npm install -g @uzukko/agentpm
```

入れたことがある場合も、同じコマンドで最新版になります。

### 2. ログインする

```bash
agentpm login
```

聞かれる内容:

| 聞かれるもの | 入れるもの |
|-------------|-----------|
| API URL | 何も入れずに Enter（`https://agentpm.app` につながります） |
| API Key | 「設定 → **APIキー**」または「プロジェクト設定 → **API設定**」で発行した鍵を貼り付け |
| Default Space ID | よく使うプロジェクトのID（省略可） |

入力内容は自分のパソコンの中（`~/.taskapprc.json`）に保存されます。うまくいったか確かめるには:

```bash
agentpm space list
```

プロジェクトの名前が出れば成功です（プロジェクト設定で発行した鍵なら、そのプロジェクトだけが出ます）。

> **APIキーは AI のチャットに貼らないでください**。会話の記録に残ります。ログインは自分でターミナルに入力します。

APIキーの発行については [ログインとセキュリティ](./security.md) をご覧ください。

### 3. AI に使い方を覚えさせる（AI に操作させる場合）

**Claude Code の場合**は、ターミナルで次を実行してから Claude Code を開き直します。

```bash
mkdir -p ~/.claude/skills/agentpm && curl -fsSL https://agentpm.app/skills/agentpm/SKILL.md -o ~/.claude/skills/agentpm/SKILL.md
```

あとは「AgentPM にタスクを作って」のように頼むと、説明書を読んで CLI を使います。説明書は AgentPM の最新のコマンド一覧から作られています。

**ほかの AI（Codex・Cursor など）の場合**は、次の文をチャットに貼ってください（鍵は入っていません）。

```text
https://agentpm.app/skills/agentpm/SKILL.md を読んで、AgentPM の CLI（agentpm）の使い方を覚えてください。以降、AgentPM のタスク・Wiki・ファイルの操作はこの CLI で行ってください。APIキーは私がターミナルで agentpm login を実行して登録するので、チャットには貼りません。
```

---

## よく使う操作

### CSV からタスクをまとめて登録する

```bash
# まず「どうなるか」を確認する（この時点では作られません）
agentpm task import --space-id <プロジェクトID> --file タスク一覧.csv

# 中身を確かめてから、実際に作る
agentpm task import --space-id <プロジェクトID> --file タスク一覧.csv --no-dry-run
```

- **既定は「下見」だけ**です。`--no-dry-run` を付けて初めて登録されます
- 取り込む前に、CSV の見出し行（タスク名・担当・期限など）をご確認ください

### ファイルを送る

```bash
agentpm file upload --space-id <プロジェクトID> --file 見積書.pdf
agentpm file list --space-id <プロジェクトID>
```

送ったファイルはプロジェクトの「ファイル」に並びます。CSV・TSV はそのまま[表で見る](./files.md#csv-を表で見る)ことができます。

### Wiki に書き込む

```bash
agentpm wiki create --space-id <プロジェクトID> --file 仕様メモ.md
```

Markdown や HTML のファイルを、そのまま Wiki のページにできます。

---

## そのほかにできること

| まとまり | 主なもの |
|---------|---------|
| `task` | 一覧・作成・更新・削除・CSV取り込み・自分の担当・止まっているものの抽出 |
| `ball` | ボールを渡す・ボールで絞って一覧する |
| `meeting` | 会議の作成・開始・終了・議事録 |
| `review` | レビュー依頼・承認・差し戻し |
| `milestone` | マイルストーンの作成・更新 |
| `invite` | 社内メンバー・相手先の招待リンクを作る |
| `client` | 相手先の一覧・招待（まとめて招待も可） |
| `file` | 一覧・アップロード・説明の更新 |
| `wiki` | ページの作成・更新・履歴 |
| `scheduling` | 日程の提案・回答・確定 |

コマンドの一覧は `agentpm --help`、それぞれの使い方は `agentpm task import --help` のように確認できます。

---

## うまくいかないとき

| 出てきた表示 | 原因と対処 |
|-------------|-----------|
| `command not found: agentpm` | まだ入っていません。手順1を実行してください（`node -v` で Node.js が入っているかも確かめられます） |
| `Not configured. Run: agentpm login` | ログインがまだです。手順2を実行してください |
| `権限エラー: Action "write" not allowed for this API key` | 鍵に「書き込み」を許していません。許可する操作を選び直して、鍵を発行し直してください |
| `権限エラー: User is not a member of this space` | 以前にプロジェクト設定で発行した、古い形式の鍵かもしれません（一覧に「CLI では使えない古い形式のキー」と出ます）。発行し直してください |
| `権限エラー: Space ID does not match API key scope` | プロジェクト設定で発行した鍵を、別のプロジェクトに使っています。そのプロジェクトの鍵を使うか、「設定 → APIキー」で複数のプロジェクトに使える鍵を発行してください |

---

## 注意

- **APIキーは合鍵です**。人に渡さない・チャットに貼らない（AI のチャットにも貼らない）・使わなくなったら画面から無効にしてください
- 取り込みは元に戻すのが大変です。**必ず下見（既定の動作）で中身を確認してから**登録してください

---

[← 一覧に戻る](../internal/) ｜ 関連: [ファイル](./files.md) ・ [ログインとセキュリティ](./security.md)
