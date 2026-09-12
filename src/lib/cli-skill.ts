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
