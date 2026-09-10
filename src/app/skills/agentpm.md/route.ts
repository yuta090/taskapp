import { skillMarkdownResponse } from '@/lib/cli-skill'

// 旧 URL。以前の案内（public/skills/agentpm.md）でこの URL を覚えている人・AI 向けに、同じ中身を返し続ける。
// 新しい案内は /skills/agentpm/SKILL.md（Claude Code のスキルと同じ形）を使う。
export const dynamic = 'force-static'

export function GET() {
  return skillMarkdownResponse()
}
