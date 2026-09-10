import { describe, it, expect } from 'vitest'
import { GET as getSkill } from '@/app/skills/agentpm/SKILL.md/route'
import { GET as getLegacySkill } from '@/app/skills/agentpm.md/route'
import { buildAgentpmSkill } from '@/lib/cli-skill'
import { getManifest } from '@/lib/cli-manifest'

/**
 * AI に読ませる CLI の説明書を配る URL。
 * Claude Code はスキルを `~/.claude/skills/<名前>/SKILL.md` からしか読まないので、
 * 同じ形の URL で配り、curl でそのまま置けるようにする。
 */
describe('GET /skills/agentpm/SKILL.md', () => {
  it('説明書を Markdown で返す', async () => {
    const res = await getSkill()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(await res.text()).toBe(buildAgentpmSkill(getManifest()))
  })
})

describe('GET /skills/agentpm.md（旧URL）', () => {
  it('以前の案内で URL を覚えている人向けに、同じ中身を返し続ける', async () => {
    const res = await getLegacySkill()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(await res.text()).toBe(buildAgentpmSkill(getManifest()))
  })
})
