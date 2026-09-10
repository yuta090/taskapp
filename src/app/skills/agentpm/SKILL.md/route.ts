import { skillMarkdownResponse } from '@/lib/cli-skill'

// AI 用の説明書（Claude Code のスキル）。中身はコマンド一覧から作るので、デプロイごとに1回作れば足りる。
// パスに「.」を含むので proxy（ログインの門番）を通らず、未ログインの端末から curl で取れる。
export const dynamic = 'force-static'

export function GET() {
  return skillMarkdownResponse()
}
