/**
 * プッシュ通知まわりの、画面を持たない判定。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 通知に載っているタスク（Web の src/lib/push/sendExpoPush.ts が data.taskId に入れる）。無ければ null */
export function taskIdFromPushData(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const taskId = (data as Record<string, unknown>).taskId
  return typeof taskId === 'string' && UUID_RE.test(taskId) ? taskId : null
}

interface ConstantsLike {
  easConfig?: { projectId?: string } | null
  expoConfig?: { extra?: { eas?: { projectId?: string } } } | null
}

/** Expo のプッシュトークンに要る EAS の projectId（`eas init` で app.json に入る）。無ければ null */
export function resolveEasProjectId(constants: ConstantsLike): string | null {
  return constants.easConfig?.projectId ?? constants.expoConfig?.extra?.eas?.projectId ?? null
}
