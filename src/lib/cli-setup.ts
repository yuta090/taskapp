/**
 * agentpm CLI の「入れ方・つなぎ方・AI への覚えさせ方」の正本。
 * 画面（APIキーの設定）と AI 用の説明書（/skills/agentpm/SKILL.md）の両方がここを使う。
 * 以前は画面ごとに手書きしていて、プロジェクト設定には手順が無く、
 * アカウント側は Claude Code が読まない場所にスキルを置かせていた。
 *
 * ⚠ client component からも読むので、Node 専用のもの（crypto 等）を import しないこと。
 */

/** 本番の URL。CLI の既定の接続先（packages/cli/src/config.ts の DEFAULT_API_URL）と同じ */
export const AGENTPM_ORIGIN = 'https://agentpm.app'

/** npm に公開している CLI の名前。packages/cli/package.json の name と一致させる（テストで検査） */
export const CLI_PACKAGE_NAME = '@uzukko/agentpm'

export const CLI_INSTALL_COMMAND = `npm install -g ${CLI_PACKAGE_NAME}`
export const CLI_LOGIN_COMMAND = 'agentpm login'
export const CLI_VERIFY_COMMAND = 'agentpm space list'

/** CLI が動く Node.js の下限（packages/cli/package.json の engines と同じ） */
export const CLI_NODE_MIN_VERSION = '18'

/** AI 用の説明書の置き場所。Claude Code のスキルと同じ「<名前>/SKILL.md」の形にする */
export const SKILL_PATH = '/skills/agentpm/SKILL.md'
export const SKILL_URL = `${AGENTPM_ORIGIN}${SKILL_PATH}`

/**
 * Claude Code に覚えさせるコマンド。Claude Code はスキルを `~/.claude/skills/<名前>/SKILL.md`
 * からしか読まない（`~/.claude/skills/agentpm.md` のような1枚置きは読まれない）。
 * `-f` で取得に失敗したときに HTML のエラーページをスキルとして保存しないようにする。
 */
export const CLAUDE_CODE_SKILL_COMMAND = `mkdir -p ~/.claude/skills/agentpm && curl -fsSL ${SKILL_URL} -o ~/.claude/skills/agentpm/SKILL.md`

/** Claude Code 以外の AI（Codex・Cursor など）のチャットに貼ってもらう一文。鍵は含めない */
export const AI_READ_SKILL_PROMPT =
  `${SKILL_URL} を読んで、AgentPM の CLI（agentpm）の使い方を覚えてください。` +
  '以降、AgentPM のタスク・Wiki・ファイルの操作はこの CLI で行ってください。' +
  'APIキーは私がターミナルで agentpm login を実行して登録するので、チャットには貼りません。'
