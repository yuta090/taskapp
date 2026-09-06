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
import type { ReminderTaskRef } from '@/lib/reminders/computeClientReminders'
import { buildEmailCopy, type EmailCopy } from './core'
import { REMINDER_TEMPLATE_DEFAULTS, reminderVarsByName } from './reminder'

export interface ReminderEmailProps {
  appName: string
  displayName: string | null
  overdue: ReminderTaskRef[]
  dueToday: ReminderTaskRef[]
  stalled: ReminderTaskRef[]
  appUrl: string
  settingsUrl: string
  /**
   * 運営が管理画面で編集できる文面（見出し・本文・タスクごとのボタン・補足）。差し込み済みの文字列。
   * React が描画時にエスケープするので dangerouslySetInnerHTML は使わない。
   */
  copy: EmailCopy
}

function formatDueDateLabel(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function TaskCard({ task, appUrl, showDaysOverdue, ctaLabel }: { task: ReminderTaskRef; appUrl: string; showDaysOverdue: boolean; ctaLabel: string }) {
  const taskUrl = `${appUrl}/portal/task/${task.taskId}`
  return (
    <Section className="bg-gray-50 border-solid border border-gray-200 rounded-lg p-4 mb-3">
      <Text className="text-gray-900 text-[16px] font-semibold m-0">
        {task.title}
      </Text>
      <Text className="text-gray-400 text-[13px] m-0 mt-1">
        {task.spaceName}
        {task.dueDate && (
          <>
            {' '}・期限 {formatDueDateLabel(task.dueDate)}
            {showDaysOverdue && task.daysOverdue > 0 && `・${task.daysOverdue}日超過`}
          </>
        )}
      </Text>
      <Section className="mt-3">
        <Button
          href={taskUrl}
          className="bg-brand text-white text-[14px] font-semibold px-5 py-2.5 rounded-md no-underline box-border"
        >
          {ctaLabel}
        </Button>
      </Section>
    </Section>
  )
}

export default function ReminderEmail({
  appName,
  displayName,
  overdue,
  dueToday,
  stalled,
  appUrl,
  settingsUrl,
  copy,
}: ReminderEmailProps) {
  const totalCount = overdue.length + dueToday.length + stalled.length
  const previewText = `ご対応待ちのタスクが${totalCount}件あります`

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

              {displayName && (
                <Text className="text-gray-700 text-[16px] leading-[1.6] m-0 mb-6">
                  {displayName} 様
                </Text>
              )}

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

              {overdue.length > 0 && (
                <Section className="mb-6">
                  <Heading as="h3" className="text-red-600 text-[15px] font-semibold m-0 mb-3">
                    期限を過ぎています（{overdue.length}件）
                  </Heading>
                  {overdue.map((task) => (
                    <TaskCard key={task.taskId} task={task} appUrl={appUrl} showDaysOverdue ctaLabel={copy.ctaLabel} />
                  ))}
                </Section>
              )}

              {dueToday.length > 0 && (
                <Section className="mb-6">
                  <Heading as="h3" className="text-gray-900 text-[15px] font-semibold m-0 mb-3">
                    本日が期限です（{dueToday.length}件）
                  </Heading>
                  {dueToday.map((task) => (
                    <TaskCard key={task.taskId} task={task} appUrl={appUrl} showDaysOverdue={false} ctaLabel={copy.ctaLabel} />
                  ))}
                </Section>
              )}

              {stalled.length > 0 && (
                <Section className="mb-6">
                  <Heading as="h3" className="text-gray-900 text-[15px] font-semibold m-0 mb-3">
                    ご対応をお待ちしています（{stalled.length}件）
                  </Heading>
                  {stalled.map((task) => (
                    <TaskCard key={task.taskId} task={task} appUrl={appUrl} showDaysOverdue={false} ctaLabel={copy.ctaLabel} />
                  ))}
                </Section>
              )}

              {copy.note && (
                <Text className="text-gray-500 text-[14px] leading-[1.6] m-0 mb-2">
                  {copy.note}
                </Text>
              )}

              <Hr className="border-solid border-none border-t border-gray-200 my-6" />

              <Text className="text-gray-400 text-[12px] leading-[1.5] m-0">
                このリマインドは1日最大3回送信されます。配信を停止するには{' '}
                <Link href={settingsUrl} className="text-brand no-underline font-medium">
                  設定ページ
                </Link>
                {' '}から変更できます。
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

ReminderEmail.PreviewProps = {
  appName: 'AgentPM',
  displayName: 'クライアント太郎',
  overdue: [
    { taskId: 'task-1', title: 'デザイン確認', spaceName: 'ECサイトリニューアル', dueDate: '2026-07-01', daysOverdue: 3 },
  ],
  dueToday: [
    { taskId: 'task-2', title: '見積もり承認', spaceName: 'ECサイトリニューアル', dueDate: '2026-07-05', daysOverdue: 0 },
  ],
  stalled: [],
  appUrl: 'https://app.example.com',
  settingsUrl: 'https://app.example.com/portal/settings',
  copy: buildEmailCopy(
    REMINDER_TEMPLATE_DEFAULTS.reminder_client_overdue,
    reminderVarsByName({ displayName: 'クライアント太郎', totalCount: 2, overdueCount: 1, dueTodayCount: 1, appName: 'AgentPM' }),
  ),
} satisfies ReminderEmailProps
