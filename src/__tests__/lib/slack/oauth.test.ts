import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * getSlackOAuthUrl — インストール時に要求する bot scope は、
 * docs/slack-app-manifest.json（Slack アプリ本体の設定）の bot scopes と一致していなければならない。
 *
 * 回帰の背景: authorize が chat:write / channels:read / groups:read の3つしか要求していなかったため、
 * ワークスペースに入れても `commands`（/agentpm）・`app_mentions:read`（@AgentPM）・
 * `users:read(.email)`（発言者の対応づけ）が付与されず、コマンドとメンションが動かなかった。
 */

async function load() {
  vi.resetModules()
  vi.stubEnv('SLACK_CLIENT_ID', 'client-id')
  vi.stubEnv('SLACK_STATE_SECRET', 'state-secret')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://agentpm.app')
  return import('@/lib/slack/oauth')
}

describe('getSlackOAuthUrl', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('要求する bot scope が Slack アプリ manifest の bot scopes と一致する', async () => {
    const { getSlackOAuthUrl } = await load()
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'docs/slack-app-manifest.json'), 'utf8'),
    ) as { oauth_config: { scopes: { bot: string[] } } }

    const url = new URL(getSlackOAuthUrl('org-1'))
    const requested = (url.searchParams.get('scope') ?? '').split(',').sort()

    expect(requested).toEqual([...manifest.oauth_config.scopes.bot].sort())
  })

  it('/agentpm と @メンションに必要な scope を含む', async () => {
    const { getSlackOAuthUrl } = await load()
    const scope = new URL(getSlackOAuthUrl('org-1')).searchParams.get('scope') ?? ''
    for (const s of ['commands', 'app_mentions:read', 'users:read', 'users:read.email']) {
      expect(scope.split(',')).toContain(s)
    }
  })
})
