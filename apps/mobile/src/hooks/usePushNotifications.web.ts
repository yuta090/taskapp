/**
 * Web 表示（画面の確認用。配布はしない）にはプッシュ通知の仕組みが無いので、何もしない。
 * iPhone / Android では usePushNotifications.ts が使われる。
 */
import type { AuthStep } from '~/lib/authStep'

export function usePushNotifications(_step: AuthStep): void {}
