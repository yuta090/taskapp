import { describe, it, expect } from 'vitest'
import {
  CHANNELS,
  ALL_CHANNEL_IDS,
  listChannels,
  chatChannels,
  outboundChannels,
  getChannel,
  isChannelId,
  canSendTo,
  requiredCredentialFields,
  generatedCredentialFields,
} from '@/lib/channels/registry'
import { OUTBOUND_ADAPTERS } from '@/lib/channels/adapters'

describe('channel registry', () => {
  it('各定義の id はキーと一致する', () => {
    for (const [key, def] of Object.entries(CHANNELS)) {
      expect(def.id).toBe(key)
    }
  })

  it('ALL_CHANNEL_IDS は CHANNELS の全キーを重複なく含む', () => {
    const keys = Object.keys(CHANNELS).sort()
    expect([...ALL_CHANNEL_IDS].sort()).toEqual(keys)
    expect(new Set(ALL_CHANNEL_IDS).size).toBe(ALL_CHANNEL_IDS.length)
  })

  it('主要チャットが全て登録されている', () => {
    for (const id of ['line', 'slack', 'chatwork', 'google_chat', 'discord', 'telegram', 'teams', 'whatsapp']) {
      expect(getChannel(id)).not.toBeNull()
    }
  })

  it('listChannels は表示順(ALL_CHANNEL_IDS)を保つ', () => {
    expect(listChannels().map((c) => c.id)).toEqual([...ALL_CHANNEL_IDS])
  })

  it('chatChannels は email を除外する', () => {
    expect(chatChannels().some((c) => c.id === 'email')).toBe(false)
    expect(chatChannels().every((c) => c.kind === 'chat')).toBe(true)
  })

  it('outboundChannels は outbound=true のみ', () => {
    expect(outboundChannels().every((c) => c.outbound)).toBe(true)
    // messenger/email は planned で送信不可
    expect(outboundChannels().some((c) => c.id === 'messenger')).toBe(false)
    expect(outboundChannels().some((c) => c.id === 'email')).toBe(false)
  })

  it('isChannelId / canSendTo が正しく判定する', () => {
    expect(isChannelId('line')).toBe(true)
    expect(isChannelId('nope')).toBe(false)
    expect(canSendTo('slack')).toBe(true)
    expect(canSendTo('messenger')).toBe(false) // planned
    expect(canSendTo('unknown')).toBe(false)
  })

  it('outbound=true のチャネルには必ず送信アダプタが存在する（レジストリと実装の整合）', () => {
    for (const def of outboundChannels()) {
      expect(OUTBOUND_ADAPTERS[def.id], `adapter missing for ${def.id}`).toBeTypeOf('function')
    }
  })

  it('全チャネルに資格情報フィールドの定義がある（emailを除く）', () => {
    for (const def of chatChannels()) {
      expect(def.credentialFields.length).toBeGreaterThan(0)
    }
  })

  it('inbound=true のチャネルは受信Webhookパスを持つ', () => {
    for (const def of chatChannels()) {
      if (def.inbound) {
        expect(def.webhookPath, `${def.id} inbound but no webhookPath`).toBeTruthy()
      }
    }
  })

  it('account単位で受ける受信チャネル(telegram/chatwork/whatsapp/slack)は{accountId}を含むパス', () => {
    for (const id of ['telegram', 'chatwork', 'whatsapp', 'slack'] as const) {
      expect(CHANNELS[id].inbound).toBe(true)
      expect(CHANNELS[id].webhookPath).toContain('{accountId}')
    }
  })
})

describe('credential field 分類（generated / optional）', () => {
  it('Telegram の webhook_secret はサーバー生成（generated=true・オペレーター入力不要）', () => {
    const wh = CHANNELS.telegram.credentialFields.find((f) => f.key === 'webhook_secret')
    expect(wh?.generated).toBe(true)
    // bot_token はオペレーター入力（generatedではない）
    const bot = CHANNELS.telegram.credentialFields.find((f) => f.key === 'bot_token')
    expect(bot?.generated).toBeFalsy()
  })

  it('受信の署名検証フィールドは登録時任意（プロバイダ発行後に再登録で貼付する二段構え）', () => {
    // 受信は実装済みだが、これらの値はアカウント作成後にプロバイダ側で発行される（URLが要る）ため
    // 初回登録では任意入力にし、再登録（ローテート）で貼り付ける。
    const cwWebhook = CHANNELS.chatwork.credentialFields.find((f) => f.key === 'webhook_token')
    expect(cwWebhook?.optional).toBe(true)
    const waAppSecret = CHANNELS.whatsapp.credentialFields.find((f) => f.key === 'app_secret')
    expect(waAppSecret?.optional).toBe(true)
  })

  it('requiredCredentialFields は generated/optional を除いたオペレーター必須入力のみ', () => {
    const req = requiredCredentialFields(CHANNELS.telegram).map((f) => f.key)
    expect(req).toEqual(['bot_token'])

    const cwReq = requiredCredentialFields(CHANNELS.chatwork).map((f) => f.key)
    expect(cwReq).toEqual(['api_token']) // webhook_token(optional)は除外

    const waReq = requiredCredentialFields(CHANNELS.whatsapp).map((f) => f.key)
    expect(waReq).toEqual(['access_token', 'phone_number_id']) // app_secret(optional)は除外
  })

  it('generatedCredentialFields はサーバー生成フィールドのみ', () => {
    expect(generatedCredentialFields(CHANNELS.telegram).map((f) => f.key)).toEqual(['webhook_secret'])
    // WhatsApp の verify_token もサーバー生成（GET購読検証用）
    expect(generatedCredentialFields(CHANNELS.whatsapp).map((f) => f.key)).toEqual(['verify_token'])
    // 生成フィールドを持たないチャネルは空
    expect(generatedCredentialFields(CHANNELS.slack)).toEqual([])
  })

  it('generated フィールドは必ず secret（機微値）である', () => {
    for (const def of chatChannels()) {
      for (const f of generatedCredentialFields(def)) {
        expect(f.secret, `${def.id}.${f.key} must be secret`).toBe(true)
      }
    }
  })
})
