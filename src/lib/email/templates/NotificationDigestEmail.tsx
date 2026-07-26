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
import type { DigestSection } from '@/lib/notifications/digest'

export interface NotificationDigestEmailProps {
  appName: string
  displayName: string | null
  sections: DigestSection[]
  totalCount: number
  appUrl: string
  settingsUrl: string
}

export default function NotificationDigestEmail({
  appName,
  displayName,
  sections,
  totalCount,
  appUrl,
  settingsUrl,
}: NotificationDigestEmailProps) {
  const previewText = `今日の更新が${totalCount}件あります`

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
                今日の更新が{totalCount}件あります
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
                このメールは1日1回のまとめ通知です。
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
