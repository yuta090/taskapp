import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Heading,
  Text,
  Button,
  Link,
  Hr,
  Tailwind,
  pixelBasedPreset,
} from '@react-email/components'
import type { DigestSection, PendingInvitesSummary } from '@/lib/notifications/digest'

/**
 * 'daily' = 毎朝1回のまとめ / 'immediate' = 数分ためて送る「返事待ち」だけのまとめ。
 * 中身の作りは同じ（種類別の一覧）なので、見出しと注記だけを差し替える。
 */
export type NotificationDigestVariant = 'daily' | 'immediate'

export interface NotificationDigestEmailProps {
  appName: string
  displayName: string | null
  sections: DigestSection[]
  totalCount: number
  variant?: NotificationDigestVariant
  /** 未承諾の招待（作成から3日以上）のまとめ。未設定なら節を出さない */
  pendingInvites?: PendingInvitesSummary
  appUrl: string
  settingsUrl: string
}

export default function NotificationDigestEmail({
  appName,
  displayName,
  sections,
  totalCount,
  variant = 'daily',
  pendingInvites,
  appUrl,
  settingsUrl,
}: NotificationDigestEmailProps) {
  const headline =
    variant === 'immediate'
      ? `あなたの返事を待っている件が${totalCount}件あります`
      : `今日の更新が${totalCount}件あります`
  const previewText = headline

  return (
    <Html lang="ja">
      <Tailwind
        config={{
          presets: [pixelBasedPreset],
          theme: {
            extend: {
              colors: {
                brand: '#4f46e5',
                'brand-dark': '#4338ca',
              },
            },
          },
        }}
      >
        <Head />
        <Preview>{previewText}</Preview>
        <Body className="bg-gray-100 font-sans py-10">
          <Container className="max-w-[600px] mx-auto">
            {/* Header */}
            <Section className="bg-brand rounded-t-lg py-6 px-6 text-center">
              <Heading as="h1" className="text-white text-[24px] font-semibold m-0">
                {appName}
              </Heading>
            </Section>

            {/* Content */}
            <Section className="bg-white px-10 py-10">
              <Heading as="h2" className="text-gray-900 text-[20px] font-semibold m-0 mb-4">
                {headline}
              </Heading>

              {displayName && (
                <Text className="text-gray-700 text-[16px] leading-[1.6] m-0 mb-6">
                  {displayName} 様
                </Text>
              )}

              {sections.map((section) => (
                <Section key={section.category} className="mb-6">
                  <Heading as="h3" className="text-gray-900 text-[15px] font-semibold m-0 mb-3">
                    {section.label}（{section.items.length}件）
                  </Heading>
                  {section.items.map((item, idx) => (
                    <Section
                      key={idx}
                      className="bg-gray-50 border-solid border border-gray-200 rounded-lg px-4 py-3 mb-2"
                    >
                      <Text className="text-gray-900 text-[15px] font-semibold m-0">
                        {item.title}
                      </Text>
                      {item.spaceName && (
                        <Text className="text-gray-400 text-[13px] m-0 mt-1">
                          {item.spaceName}
                        </Text>
                      )}
                    </Section>
                  ))}
                </Section>
              ))}

              {pendingInvites && pendingInvites.count > 0 && (
                <Section className="mb-6">
                  <Heading as="h3" className="text-gray-900 text-[15px] font-semibold m-0 mb-3">
                    未承諾の招待（{pendingInvites.count}件）
                  </Heading>
                  <Text className="text-gray-700 text-[14px] leading-[1.6] m-0 mb-3">
                    未承諾の招待が{pendingInvites.count}件あります。招待を再送するには 設定 → メンバー から。
                  </Text>
                  {pendingInvites.items.map((item, idx) => (
                    <Section
                      key={idx}
                      className="bg-gray-50 border-solid border border-gray-200 rounded-lg px-4 py-3 mb-2"
                    >
                      <Text className="text-gray-900 text-[14px] m-0">{item.email}</Text>
                      {item.spaceName && (
                        <Text className="text-gray-400 text-[13px] m-0 mt-1">
                          {item.spaceName}
                        </Text>
                      )}
                    </Section>
                  ))}
                </Section>
              )}

              <Section className="mt-6 text-center">
                <Button
                  href={appUrl}
                  className="bg-brand text-white text-[14px] font-semibold px-6 py-3 rounded-md no-underline box-border"
                >
                  アプリで確認する
                </Button>
              </Section>

              <Hr className="border-gray-200 my-8" />

              <Text className="text-gray-400 text-[12px] leading-[1.6] m-0 text-center">
                {variant === 'immediate'
                  ? 'このメールは、あなたの返事を待っている件だけをお送りしています。それ以外は1日1回のまとめでお届けします。'
                  : 'このメールは1日1回のまとめ通知です。'}
                <br />
                受け取る種類や頻度は{' '}
                <Link href={settingsUrl} className="text-brand underline">
                  通知設定
                </Link>{' '}
                でいつでも変更・停止できます。
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}
