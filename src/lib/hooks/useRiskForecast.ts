'use client'

import { useMemo } from 'react'
import {
  calculateRiskForecasts,
  type RiskAssessment,
} from '@/lib/risk/calculateRisk'
import type { Task, Milestone } from '@/types/database'

interface UseRiskForecastOptions {
  tasks: Task[]
  milestones: Milestone[]
}

interface UseRiskForecastReturn {
  /** Map of milestone ID to risk assessment */
  forecasts: Map<string, RiskAssessment>
}

/**
 * Hook to calculate risk forecasts for milestones based on task velocity.
 *
 * Pure computation from props - no Supabase queries needed since
 * tasks and milestones are already fetched by parent hooks.
 */
export function useRiskForecast({
  tasks,
  milestones,
}: UseRiskForecastOptions): UseRiskForecastReturn {
  const forecasts = useMemo(
    () => calculateRiskForecasts(tasks, milestones),
    [tasks, milestones]
  )

  return { forecasts }
}
