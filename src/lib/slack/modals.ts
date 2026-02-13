/**
 * Slack Block Kit モーダルビルダー（タスク作成）
 */

interface TaskCreateModalOptions {
  spaceId: string
  spaceName: string
  channelId: string
  members: Array<{ id: string; name: string }>
  callbackId?: string
}

export function buildTaskCreateModal(options: TaskCreateModalOptions) {
  const {
    spaceId,
    spaceName,
    channelId,
    members,
    callbackId = 'task_create_modal',
  } = options

  const assigneeOptions = members.map((m) => ({
    text: { type: 'plain_text' as const, text: m.name },
    value: m.id,
  }))

  // Slack static_select requires non-empty options — omit block if no members
  const blocks: unknown[] = [
    // プロジェクト名（読み取り専用コンテキスト）
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `*プロジェクト:* ${spaceName}` },
      ],
    },
    // タイトル（必須）
    {
      type: 'input',
      block_id: 'block_title',
      label: { type: 'plain_text' as const, text: 'タイトル' },
      element: {
        type: 'plain_text_input',
        action_id: 'title_input',
        placeholder: { type: 'plain_text' as const, text: 'タスクのタイトルを入力' },
      },
    },
  ]

  if (assigneeOptions.length > 0) {
    blocks.push({
      type: 'input',
      block_id: 'block_assignee',
      optional: true,
      label: { type: 'plain_text' as const, text: '担当者' },
      element: {
        type: 'static_select',
        action_id: 'assignee_select',
        placeholder: { type: 'plain_text' as const, text: '担当者を選択' },
        options: assigneeOptions,
      },
    })
  }

  blocks.push(
    // 期限（任意）
    {
      type: 'input',
      block_id: 'block_due_date',
      optional: true,
      label: { type: 'plain_text' as const, text: '期限' },
      element: {
        type: 'datepicker',
        action_id: 'due_date_pick',
        placeholder: { type: 'plain_text' as const, text: '日付を選択' },
      },
    },
    // 説明（任意）
    {
      type: 'input',
      block_id: 'block_description',
      optional: true,
      label: { type: 'plain_text' as const, text: '説明' },
      element: {
        type: 'plain_text_input',
        action_id: 'description_input',
        multiline: true,
        placeholder: { type: 'plain_text' as const, text: 'タスクの説明を入力' },
      },
    },
  )

  return {
    type: 'modal' as const,
    callback_id: callbackId,
    title: { type: 'plain_text' as const, text: 'タスク作成' },
    submit: { type: 'plain_text' as const, text: '作成' },
    close: { type: 'plain_text' as const, text: 'キャンセル' },
    private_metadata: JSON.stringify({ spaceId, channelId }),
    blocks,
  }
}

interface SlackViewState {
  values: Record<string, Record<string, {
    type: string
    value?: string | null
    selected_option?: { value: string } | null
    selected_date?: string | null
  }>>
}

interface SlackView {
  private_metadata: string
  state: SlackViewState
}

export function parseTaskCreateSubmission(view: SlackView) {
  const { spaceId, channelId } = JSON.parse(view.private_metadata)
  const values = view.state.values

  return {
    title: values.block_title.title_input.value!,
    assigneeId: values.block_assignee?.assignee_select?.selected_option?.value,
    dueDate: values.block_due_date?.due_date_pick?.selected_date ?? undefined,
    description: values.block_description?.description_input?.value ?? undefined,
    spaceId: spaceId as string,
    channelId: channelId as string,
  }
}
