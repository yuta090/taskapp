import type {
  NotificationProvider,
  NotificationEventType,
  NotificationContext,
  TaskNotificationPayload,
} from './types'

class NotificationRegistry {
  private providers: Map<string, NotificationProvider> = new Map()

  register(provider: NotificationProvider): void {
    this.providers.set(provider.name, provider)
  }

  get(name: string): NotificationProvider | undefined {
    return this.providers.get(name)
  }

  /** 全プロバイダーにfan-out。1つのエラーが他をブロックしない */
  async notifyAll(
    event: NotificationEventType,
    context: NotificationContext,
    payload: TaskNotificationPayload,
  ): Promise<Array<{ provider: string; messageId: string | null; error?: string }>> {
    const results: Array<{ provider: string; messageId: string | null; error?: string }> = []

    for (const [name, provider] of this.providers) {
      if (!provider.isConfigured()) continue

      try {
        const isConfigured = await provider.isSpaceConfigured(context.spaceId)
        if (!isConfigured) continue

        const result = await provider.sendTaskNotification(event, context, payload)
        results.push({ provider: name, ...result })
      } catch (err) {
        console.error(`Notification provider ${name} failed:`, err)
        results.push({
          provider: name,
          messageId: null,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    return results
  }
}

export const notificationRegistry = new NotificationRegistry()
