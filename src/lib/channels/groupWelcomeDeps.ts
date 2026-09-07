import {
  findAccountForSecretaryPush,
  assignDigestNumbersToNewTasks,
  updateChannelGroupMetadata,
} from '@/lib/channels/store'
import { sendSecretaryPush } from '@/lib/channels/send/secretaryPush'
import { sendGroupWelcome, type GroupWelcomeTarget, type GroupWelcomeResult } from '@/lib/channels/groupWelcome'

/**
 * groupWelcome（判断だけを持つ）に、本物の DB と送信境界をつなぐ配線。
 *
 * 判断と配線を分けているのは、承認routeのテストで Slack へ実際に投げないようにするため
 * （slack/webhookDeps.ts と同じ作法）。
 */
export function sendGroupWelcomeForApprovedGroup(target: GroupWelcomeTarget): Promise<GroupWelcomeResult> {
  return sendGroupWelcome(target, {
    loadAccount: findAccountForSecretaryPush,
    push: sendSecretaryPush,
    saveTutorialState: (groupId, state) => updateChannelGroupMetadata(groupId, { tutorial: state }),
    assignDigestNumbersToNewTasks,
    now: () => new Date(),
  })
}
