// TODO: Stub file - implement actual billing limits hook

interface BillingLimits {
  plan_name?: string
  projects_used: number
  projects_limit: number
  members_used: number
  members_limit: number
  tasks_used: number
  tasks_limit: number
  meetings_used: number
  meetings_limit: number
  clients_used: number
  clients_limit: number
  storage_used_bytes: number
  storage_limit_bytes: number
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useBillingLimits(_orgId?: string) {
  return {
    limits: null as BillingLimits | null,
    loading: false,
    error: null,
    refresh: () => Promise.resolve(),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    isAtLimit: (_type: string) => false,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getRemainingCount: (_type: string) => 0,
  }
}
