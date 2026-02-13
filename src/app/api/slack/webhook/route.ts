import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifySlackRequest } from '@/lib/slack/verify'
import { postSlackMessage } from '@/lib/slack/client'
import { callLlm } from '@/lib/ai/client'
import { buildMentionContext } from '@/lib/ai/context'
import { buildSystemPrompt } from '@/lib/ai/prompt'

export const runtime = 'nodejs'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface AppMentionEvent {
  type: 'app_mention'
  text: string
  user: string
  channel: string
  ts: string
}

/**
 * app_mention イベントを非同期で処理
 */
async function processAppMention(event: AppMentionEvent): Promise<void> {
  const { text, channel, ts } = event

  // チャンネルからspace/org情報を取得
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: channelLink, error: linkError } = await (supabaseAdmin as any)
    .from('space_slack_channels')
    .select('space_id, org_id')
    .eq('channel_id', channel)
    .single()

  if (linkError || !channelLink) {
    // このチャンネルはどのspaceにも紐付いていない → 無視
    console.log('app_mention in unlinked channel, ignoring:', channel)
    return
  }

  const spaceId = channelLink.space_id as string
  const orgId = channelLink.org_id as string

  if (!spaceId || !orgId) {
    console.log('Could not resolve space/org for channel:', channel)
    return
  }

  // ボットメンション部分を除去（<@BOT_ID> プレフィックス）
  const userMessage = text.replace(/<@[A-Z0-9]+>\s*/g, '').trim()

  if (!userMessage) {
    await postSlackMessage(orgId, channel, 'お手伝いできることはありますか？質問をどうぞ。', [], ts)
    return
  }

  try {
    // コンテキスト構築 → LLM呼び出し
    const context = await buildMentionContext(spaceId, orgId)
    const systemPrompt = buildSystemPrompt(context)

    const response = await callLlm({
      orgId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    })

    await postSlackMessage(orgId, channel, response.content, [], ts)
  } catch (err) {
    console.error('app_mention processing error:', err)

    const errorMessage = err instanceof Error && err.message.includes('AI未設定')
      ? 'AI機能が設定されていません。設定画面からAPIキーを登録してください。'
      : '申し訳ありません。応答の生成に失敗しました。'

    await postSlackMessage(orgId, channel, errorMessage, [], ts).catch(console.error)
  }
}

/**
 * POST /api/slack/webhook — Slack Events API 受信
 */
export async function POST(request: NextRequest) {
  // Slackリトライをスキップ（重複処理防止）
  if (request.headers.get('x-slack-retry-num')) {
    return NextResponse.json({ ok: true })
  }

  const { verified, body } = await verifySlackRequest(request)
  if (!verified) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const data = JSON.parse(body)

  // Slack URL verification challenge
  if (data.type === 'url_verification') {
    return NextResponse.json({ challenge: data.challenge })
  }

  // イベント処理
  if (data.type === 'event_callback') {
    const event = data.event

    if (event?.type === 'app_mention') {
      // 非同期で処理（Slack 3秒タイムアウト対策）
      processAppMention(event as AppMentionEvent).catch(console.error)
    }
  }

  return NextResponse.json({ ok: true })
}
