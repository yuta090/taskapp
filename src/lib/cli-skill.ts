import { getManifest, type Manifest, type ManifestOption, type ManifestSubcommand } from '@/lib/cli-manifest'
import { CLI_INSTALL_COMMAND, CLI_LOGIN_COMMAND, CLI_NODE_MIN_VERSION, SKILL_URL } from '@/lib/cli-setup'

/**
 * AI（Claude Code 等）に読ませる agentpm の説明書（スキル）を、コマンド一覧(manifest)から組み立てる。
 * 手書きの説明書は機能を足すたびに古くなる（3 月の版には CSV 取り込み・ファイル送信が無かった）ので、
 * コマンドの部分は manifest から毎回作り、決まりごと（鍵の扱い・下見してから実行など）だけを手で書く。
 *
 * ⚠ getManifest が Node の crypto を使うため、client component から import しないこと。
 */

/** stdinFormat='text' のコマンドに CLI(0.3.0+) が足す入力元（packages/cli/src/dynamic-loader.ts の FILE_OPTION_FLAGS と同じ） */
const TEXT_FILE_OPTION: ManifestOption = { flags: '--file <path>', param: 'file' }

/** `-s, --space-id <uuid>` → `--space-id <uuid>`。AI には長い名前で書かせる */
function longFlag(flags: string): string {
  const parts = flags.split(',').map((p) => p.trim())
  return parts.find((p) => p.startsWith('--')) ?? parts[parts.length - 1]
}

function flagName(flags: string): string {
  return longFlag(flags).split(' ')[0]
}

function usageLine(path: string, options: ManifestOption[]): string {
  const required = options.filter((o) => o.required).map((o) => longFlag(o.flags))
  const optional = options.filter((o) => !o.required).map((o) => `[${longFlag(o.flags)}]`)
  return ['agentpm', path, ...required, ...optional].join(' ')
}

function entryLines(path: string, description: string, options: ManifestOption[], examples: string[] = []): string[] {
  const lines = [`- \`${usageLine(path, options)}\` — ${description}`]
  const choices = options.flatMap((o) => (o.choices?.length ? [`\`${flagName(o.flags)}\` ${o.choices.join('|')}`] : []))
  if (choices.length) lines.push(`  - 選べる値: ${choices.join(' / ')}`)
  for (const example of examples) lines.push(`  - 例: \`${example}\``)
  return lines
}

function optionsOf(sub: ManifestSubcommand): ManifestOption[] {
  if (sub.stdinFormat !== 'text' || sub.options.some((o) => flagName(o.flags) === '--file')) return sub.options
  return [...sub.options, TEXT_FILE_OPTION]
}

function commandLines(manifest: Manifest): string[] {
  const lines: string[] = []
  for (const cmd of manifest.commands) {
    lines.push(`### ${cmd.name} — ${cmd.description}`, '')
    if (cmd.subcommands?.length) {
      for (const sub of cmd.subcommands) {
        if (sub.hidden || sub.deprecated) continue
        lines.push(...entryLines(`${cmd.name} ${sub.name}`, sub.description, optionsOf(sub), sub.examples))
      }
    } else {
      lines.push(...entryLines(cmd.name, cmd.description, cmd.options ?? []))
    }
    lines.push('')
  }
  return lines
}

export function buildAgentpmSkill(manifest: Manifest): string {
  const lines = [
    '---',
    'name: agentpm',
    'description: AgentPM（ボールで「次に動く人」を管理するタスク管理）を agentpm CLI で操作する。「タスクを作って」「進捗を確認して」「ボールを渡して」「レビュー」「マイルストーン」「会議・議事録」「Wiki に転記して」「CSV から取り込んで」「ファイルを上げて」などと言われたときに使う。GitHub の PR（プルリクエスト）を作る・レビューする場面でも、タスク番号（TP-番号）を PR に書いて紐づけるときに使う。',
    '---',
    '',
    '# AgentPM CLI（agentpm）',
    '',
    'AgentPM のタスク・Wiki・ファイルなどを `agentpm` コマンドで操作するための説明書。',
    `コマンドの部分は AgentPM のコマンド一覧（v${manifest.version}）から自動で作っている。最新版: ${SKILL_URL}`,
    '',
    '## 最初に確かめること',
    '',
    `1. \`agentpm --version\` が動くか確かめる。無ければ \`${CLI_INSTALL_COMMAND}\` を実行する（Node.js ${CLI_NODE_MIN_VERSION} 以上が必要）。`,
    `2. \`agentpm space list --json\` でつながるか確かめる（プロジェクト設定で作ったキーなら、そのプロジェクトだけが出る）。\`Not configured. Run: agentpm login\` と出たら、**ユーザー本人にターミナルで \`${CLI_LOGIN_COMMAND}\` を実行してもらう**。`,
    '   - APIキー（合鍵）はチャットに貼ってもらわない。会話の記録に残るため。貼られてしまったら、画面でその鍵を削除して発行し直すよう伝える。',
    '3. 操作するプロジェクトを決める。`agentpm space list --json` の一覧から選んで `--space-id <uuid>` で渡す（login で既定のプロジェクトを設定していれば省略できる）。',
    '',
    '## 守ること',
    '',
    '- 結果を読むときは必ず `--json` を付ける。',
    '- CSV 取り込み（`task import`）と削除（`task delete`）は、まず下見（既定の動作）の結果をユーザーに見せ、了承を得てから `--no-dry-run` を付けて実行する。',
    '- 日付は `YYYY-MM-DD`。',
    '- ボール（次に動く側）は既定で `internal`（社内）。相手先の確認・承認・資料提供を待つタスクだけ `client` にする。`client` にするものは作る前にユーザーに確認する。',
    '- 使い方が分からないときは `agentpm <コマンド> <サブコマンド> --help` を見る。コマンドが見つからないときは `agentpm update` で一覧を取り直す。',
    '',
    '## GitHub の PR とタスクを紐づける',
    '',
    'GitHub の PR のタイトルか本文、またはブランチ名に TP-番号（例: TP-42）を書くと、その PR がタスクに自動で紐づき、取り込まれた（merge された）ときにタスクの担当者に通知が届く。番号は `agentpm task list --json` / `agentpm task get --json` の `number` で分かる。',
    '',
    '## Wiki や議事録に、アプリの中の物へのリンクを貼る',
    '',
    'タスク・Wikiページ・議事録・ファイルは、一覧と詳細（`--json`）に `link` が入っている。画面で開くための URL で、そのまま本文に貼れる。',
    '',
    '```',
    '# 例: 仕様書のページに、関係するタスクと議事録へのリンクを入れる',
    'agentpm task list --json          # 各タスクの link を取る',
    'agentpm meeting list --json       # 各会議の link を取る',
    'agentpm wiki create --title "設計メモ" --body "- 関連タスク: [TP-42 トップページを作る](/<org>/project/<space>?task=<id>)"',
    '```',
    '',
    '- Markdown の `[名前](link)` の形で書く。`link` の値をそのまま使い、自分で URL を組み立てない（綴りがずれると押しても開かない）。',
    '- ファイルの `link` はダウンロードが始まるリンク。画面の移動ではない。',
    '- 画面側の「リンクを挿入」ボタンが作るリンクと同じ形なので、CLI で貼ったリンクも画面で貼ったリンクも同じように開く。',
    '',
    '**タスクの説明文に貼るときは、Markdown にせず URL をそのまま書く。** 説明文はただの文字として表示されるので、`[名前](link)` と書くと記号がそのまま出る。`link` の値だけを書けば押せるリンクになる。',
    '',
    '```',
    'agentpm task update --task-id <id> --description "仕様は /<org>/project/<space>/wiki?page=<id> を参照"',
    '```',
    '',
    '## 決めることをタスクにして、決まったら確定する',
    '',
    '会議で決めることは「決定事項のタスク」にする。ふつうのタスクとの違いは、**決まるまで完了にできない**こと。',
    '作り方は、Wiki ページに「仕様書として扱う」を入れて、そのページをタスクに紐づける。',
    '',
    '```',
    '# 決定事項のタスクを作る（wikiPageId を渡すと決定事項のタスクになる）',
    'agentpm task create --title "玄関の向きを決める" --type spec --wiki-page-id <pageId>',
    '',
    '# 既存のタスクに紐づけて決定事項のタスクにする',
    'agentpm task update --task-id <id> --wiki-page-id <pageId>',
    '',
    '# 会議で決まったら確定する',
    'agentpm spec decide --task-id <id> --state decided --note "9/14の定例で合意"',
    '```',
    '',
    '- 確定すると、紐づく Wiki ページの**末尾に**「決定: <タスクの題名> (日付)」が入る。書き足す前の本文は「確定時点の控え」として残る。',
    '- 紐づけるページに「仕様書として扱う」が入っていなければ、ただの参考資料として付くだけで、完了は止まらない。',
    '- 議事録からまとめて作れる（下記）。',
    '',
    '### 議事録からタスクをまとめて作る',
    '',
    '```',
    '# 1) 議事録に「決めること」を書く（書き方は下の「議事録の行の書き方」）',
    'agentpm minutes get --meeting-id <id> --json          # updated_at を取る',
    'agentpm minutes update --meeting-id <id> --file ./minutes.md --expected-updated-at "<updated_at>"',
    '',
    '# 2) まず候補を見る（作らない）',
    'agentpm minutes taskify --meeting-id <id> --dry-run',
    '',
    '# 3) よければ作る',
    'agentpm minutes taskify --meeting-id <id>',
    '```',
    '',
    '- 拾うのは**未チェック**（`- [ ]`）の行だけ。`- [x]` は拾わない。',
    '- **Wiki ページのリンクが無くても候補になる。**「田畠さんにレビュー依頼」のような、ただのやることもタスクになる。',
    '- 差し込んだページが「仕様書として扱う」なら決定事項のタスク、そうでなければ参考資料付きのふつうのタスク。',
    '- 作成済みの行は飛ばす（同じ行から二重に作らない）。',
    '- **`--dry-run` で先に確かめる。** 行の書き方を間違えていると、意図しないタスクができる。',
    '- 本文がずれていると「別の場所で更新されています」で止まり、1件も作られない。読み直してからやり直す。',
    '- `--state considering` で検討中に戻せる。戻すと、また完了できなくなる。',
    '',
    '**「決まっていないのに完了にする」はできない。** `決定事項が未決のため完了できません` が返ったら、先に `spec decide` で確定するか、ユーザーに決めてもらう。勝手に確定させない — 決めるのは人。',
    '',
    '### 議事録の行の書き方',
    '',
    '議事録の本文は Markdown。**行の書き方で、できるタスクの中身が決まる。**',
    '',
    '```markdown',
    '- [ ] 見積を出す（期限: 9/20）',
    '- [ ] 間取りを決める [新社屋の間取り](/<org>/project/<space>/wiki?page=<ページID>)（期限: 2027/1/5）',
    '```',
    '',
    '- **行の先頭から書く。**字下げした行（`  - [ ] …`）は候補に出ない。折りたたみや箇条書きの中に入れない。',
    '- 期限は `（期限: 9/20）` か `（期限: 2027/1/5）`。年を省くと今年として読む（過ぎていれば来年）。',
    '- **担当は書いても読まれない。**担当はタスクを作ったあとに `task update --assignee-id` で決める。',
    '- 資料のページのリンクは `wiki list --json` / `wiki get --json` の `link` をそのまま使う。無ければ `wiki create` で作ってから貼る。',
    '',
    '### 議事録だけに使う書き方（画面と同じ見た目になる）',
    '',
    '```markdown',
    '<!--note-->会議中にその場で足した補足。背景に色が付いて、書いた日時が出る',
    '<!--note:2026-09-15T14:30-->日時を自分で入れるならこの形（日本時間・1行目だけに付ける）',
    '',
    '- <!--toggle-->前回の経緯',
    '  - 値段の話',
    '  - 納期の話',
    '```',
    '',
    '- `<!--note-->` = **会議メモ**。1つのメモが複数行なら、**行ごとに**付ける（付けないと別のブロックに割れる）。',
    '- `- <!--toggle-->` = **折りたたみ**。字下げした行が中身になる。',
    '- どちらも画面には印の文字は出ない。**折りたたみの中のチェックリストはタスク化の候補に出ない**（字下げされるため）。',
    '',
    '### チェックを付けても、CLI からはタスクは完了しない',
    '',
    '画面では議事録の行にチェックを入れるとタスクが完了になるが、これはブラウザの中の処理。',
    '**CLI から本文を `- [x]` に書き換えてもタスクは完了しない**（見た目が変わるだけ）。完了にするときは:',
    '',
    '```',
    'agentpm task update --task-id <id> --status done',
    '```',
    '',
    'タスクの ID は `minutes taskify --json` の結果か、行末の `<!--task:...-->` の中にある。',
    '',
    '## 議事録や Wiki を書き換えるときは、先に読んで版を渡す',
    '',
    '**`minutes update` と `wiki update` は本文を丸ごと差し替える。** 直前に読んだ版を渡さないと、',
    'その間に人やAI秘書が書いた内容を黙って消す。議事録には控えが無いので元に戻せない。',
    '',
    '```',
    '# 1) 読む（updated_at が返る）',
    'agentpm minutes get --meeting-id <id> --json',
    '',
    '# 2) 読んだ updated_at をそのまま渡して書く',
    'agentpm minutes update --meeting-id <id> --file ./minutes.md --expected-updated-at "<1で返った updated_at>"',
    '```',
    '',
    '- **必ず 1 の直後に 2 を行う。** 間に人が書く時間があるほど断られやすくなるが、断られるほうが正しい。',
    '- `この内容は、別の場所で更新されています` が返ったら、**もう一度読み直してから**書き直す。',
    '  自分の書きかけを機械的に上書きしない。消えるのは相手の文章。',
    '- `wiki update` も同じ（`wiki get` の `updated_at` を `--expected-updated-at` に渡す）。',
    '- **末尾に足すだけなら `minutes append` を使う。** こちらは衝突しないので版を渡す必要はない。',
    '',
    '## 断られたとき',
    '',
    '権限で断られると `権限エラー: <理由>` が返る。理由ごとの対処:',
    '',
    '- `権限エラー: このAPIキーでは操作「write」を実行できません` など: 鍵に許可されていない操作。ユーザーに、設定画面で必要な操作（書き込み・一括操作など）を許可した鍵を発行し直してもらう。',
    '- `権限エラー: Space ID does not match API key scope`: プロジェクト設定で作った鍵を、別のプロジェクトに使っている。そのプロジェクトの鍵を使うか、アカウントの「設定 → APIキー」で複数プロジェクト用の鍵を作ってもらう。',
    '- `権限エラー: User is not a member of this space`: 鍵の持ち主がそのプロジェクトのメンバーでない、または古い形式の鍵（持ち主を記録していない、2026 年 9 月より前にプロジェクト設定で作った鍵）。`--space-id` を確かめ、直らなければ鍵を発行し直してもらう。',
    '- そのほかの `権限エラー:`（`Viewer role can only read` など）: 鍵の持ち主の役割では許されていない操作。無理に続けず、ユーザーに伝える。',
    '- `Internal server error`: AgentPM 側の不具合。少し待って 1 回だけやり直し、続くならユーザーに伝える（ログインのやり直しや鍵の貼り付けは求めない）。',
    '',
    '## コマンド一覧',
    '',
    ...commandLines(manifest),
    '### 設定（CLI に最初から入っているコマンド）',
    '',
    `- \`${CLI_LOGIN_COMMAND}\` — 接続先と APIキーを登録する（ユーザー本人がターミナルで実行する）`,
    '- `agentpm config show` — 今の設定を見る（鍵は伏せて表示）',
    '- `agentpm update` — コマンド一覧をサーバーから取り直す',
    '',
  ]
  return lines.join('\n')
}

/** /skills/agentpm/SKILL.md（と旧 URL）が返す中身 */
export function skillMarkdownResponse(): Response {
  return new Response(buildAgentpmSkill(getManifest()), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  })
}
