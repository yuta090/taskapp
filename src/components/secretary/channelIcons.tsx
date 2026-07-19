import {
  ChatCircle,
  ChatCircleDots,
  SlackLogo,
  MicrosoftTeamsLogo,
  DiscordLogo,
  TelegramLogo,
  WhatsappLogo,
  MessengerLogo,
  GoogleLogo,
  EnvelopeSimple,
} from '@phosphor-icons/react/dist/ssr'
import type { ChannelId } from '@/lib/channels/registry'

/**
 * チャネルID → 表示アイコンの対応。registry(真実の源)に対する見た目の付随情報を
 * UI層に閉じておく（registryはサーバー/型でも使うためJSXアイコンを持たせない）。
 */
export const CHANNEL_ICONS: Record<ChannelId, typeof ChatCircle> = {
  line: ChatCircle,
  slack: SlackLogo,
  chatwork: ChatCircleDots,
  google_chat: GoogleLogo,
  discord: DiscordLogo,
  telegram: TelegramLogo,
  teams: MicrosoftTeamsLogo,
  whatsapp: WhatsappLogo,
  messenger: MessengerLogo,
  email: EnvelopeSimple,
}
