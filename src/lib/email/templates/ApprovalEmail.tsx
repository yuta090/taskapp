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
import type { EmailCopy } from './core'
import { APPROVAL_TEMPLATE_DEFAULTS, approvalVarsByName, formatCurrencyJpy } from './approval'
import { buildEmailCopy } from './core'

export interface ApprovalEmailProps {
  appName: string
  taskTitle: string
  spaceName: string
  orgName: string
  actionUrl: string
  portalUrl: string
  actionType: 'approve' | 'estimate_approve'
  estimatedCost?: number | null
  dueDateLabel?: string | null
  descriptionExcerpt?: string | null
  /**
   * 運営が管理画面で編集できる文面（件名・見出し・本文・ボタン・補足）。差し込み済みの文字列を受け取る。
   * React が描画時にエスケープするので、ここで dangerouslySetInnerHTML は使わない。
   */
  copy: EmailCopy
}

export default function ApprovalEmail({
  appName,
  taskTitle,
  spaceName,
  orgName,
  actionUrl,
  portalUrl,
  actionType,
  estimatedCost,
  dueDateLabel,
  descriptionExcerpt,
  copy,
}: ApprovalEmailProps) {
  const isEstimate = actionType === 'estimate_approve'
  const previewText = isEstimate
    ? `${taskTitle} の見積もりをご確認ください`
    : `${taskTitle} の確認をお願いします`

  return (
    <Html lang="ja">
      <Tailwind
        config={{
          presets: [pixelBasedPreset],
          theme: {
            extend: {
              colors: {
                brand: '#f59e0b',
                'brand-dark': '#d97706',
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
            <Section className="bg-surface px-10 py-10">
              <Heading as="h2" className="text-gray-900 text-[20px] font-semibold m-0 mb-4">
                {copy.heading}
              </Heading>

              {copy.bodyParagraphs.map((paragraph, i) => (
                <Text key={i} className="text-gray-700 text-[16px] leading-[1.6] m-0 mb-6">
                  {paragraph.split('\n').map((line, j, arr) => (
                    <span key={j}>
                      {line}
                      {j < arr.length - 1 && <br />}
                    </span>
                  ))}
                </Text>
              ))}

              {/* Task Card */}
              <Section className="bg-gray-50 border-solid border border-gray-200 rounded-lg p-4 mb-6">
                <Text className="text-gray-500 text-[12px] font-semibold m-0 mb-1">
                  タスク
                </Text>
                <Text className="text-gray-900 text-[16px] font-semibold m-0">
                  {taskTitle}
                </Text>
                <Text className="text-gray-400 text-[13px] m-0 mt-1">
                  {orgName} / {spaceName}
                </Text>
                {dueDateLabel && (
                  <Text className="text-gray-400 text-[13px] m-0 mt-1">
                    期限: {dueDateLabel}
                  </Text>
                )}
                {descriptionExcerpt && (
                  <Text className="text-gray-600 text-[13px] leading-[1.6] m-0 mt-2">
                    {descriptionExcerpt}
                  </Text>
                )}
              </Section>

              {/* Estimate Amount */}
              {isEstimate && estimatedCost != null && (
                <Section className="bg-amber-50 border-solid border border-amber-200 rounded-lg p-4 mb-6">
                  <Text className="text-amber-800 text-[12px] font-semibold m-0 mb-1">
                    見積もり金額
                  </Text>
                  <Text className="text-amber-900 text-[24px] font-bold m-0">
                    {formatCurrencyJpy(estimatedCost)}
                  </Text>
                </Section>
              )}

              {/* CTA Button */}
              <Section className="text-center mb-6">
                <Button
                  href={actionUrl}
                  className="bg-brand text-white text-[16px] font-semibold px-8 py-3.5 rounded-md no-underline box-border"
                >
                  {copy.ctaLabel}
                </Button>
              </Section>

              {copy.note && (
                <Text className="text-gray-500 text-[14px] text-center m-0 mb-6">
                  {copy.note}
                </Text>
              )}

              <Text className="text-gray-500 text-[14px] text-center m-0 mb-6">
                または{' '}
                <Link href={portalUrl} className="text-brand no-underline font-medium">
                  ポータルで確認
                </Link>
              </Text>

              <Hr className="border-solid border-none border-t border-gray-200 my-6" />

              <Text className="text-gray-400 text-[12px] leading-[1.5] m-0">
                このリンクは7日間有効です。差し戻しやコメントの記入はポータルから行えます。
              </Text>
            </Section>

            {/* Footer */}
            <Section className="bg-gray-50 rounded-b-lg border-solid border-none border-t border-gray-200 py-6 px-10 text-center">
              <Text className="text-gray-400 text-[12px] m-0">
                このメールに心当たりがない場合は、無視してください。
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

ApprovalEmail.PreviewProps = {
  appName: 'AgentPM',
  taskTitle: 'フロントエンド実装 - ログイン画面',
  spaceName: 'ECサイトリニューアル',
  orgName: 'クラフトテック',
  actionUrl: 'https://app.example.com/portal/email-action/abc123',
  portalUrl: 'https://app.example.com/portal',
  actionType: 'estimate_approve',
  estimatedCost: 160000,
  copy: buildEmailCopy(
    APPROVAL_TEMPLATE_DEFAULTS.approval_estimate,
    approvalVarsByName({
      taskTitle: 'フロントエンド実装 - ログイン画面',
      spaceName: 'ECサイトリニューアル',
      orgName: 'クラフトテック',
      estimatedCostLabel: formatCurrencyJpy(160000),
      dueDateLabel: '',
      appName: 'AgentPM',
    }),
  ),
} satisfies ApprovalEmailProps
