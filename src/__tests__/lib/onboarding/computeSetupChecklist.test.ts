import { describe, it, expect } from 'vitest'
import { computeSetupChecklist, type SetupChecklistData } from '@/lib/onboarding/computeSetupChecklist'

const SPACE_ID = 'space-1'

const allFalse: SetupChecklistData = {
  hasNonSampleTask: false,
  hasTeamInvite: false,
  hasClientInvite: false,
  hasPublishedTask: false,
  hasPreviewedPortal: false,
}

describe('computeSetupChecklist', () => {
  it('returns all 5 steps undone with completedCount 0 and allDone false when nothing is done', () => {
    const result = computeSetupChecklist(allFalse, SPACE_ID)

    expect(result.totalCount).toBe(5)
    expect(result.completedCount).toBe(0)
    expect(result.allDone).toBe(false)
    expect(result.steps).toHaveLength(5)
    expect(result.steps.map((s) => s.key)).toEqual([
      'create_task',
      'invite_team',
      'invite_client',
      'publish_task',
      'preview_portal',
    ])
    for (const step of result.steps) {
      expect(step.done).toBe(false)
    }
  })

  it('marks create_task done and gives it no CTA link (in-page action)', () => {
    const result = computeSetupChecklist({ ...allFalse, hasNonSampleTask: true }, SPACE_ID)

    const step = result.steps.find((s) => s.key === 'create_task')!
    expect(step.done).toBe(true)
    expect(step.href).toBeNull()
    expect(result.completedCount).toBe(1)
  })

  it('gives invite_team a CTA link to /settings/members when undone, and clears it when done', () => {
    const undone = computeSetupChecklist(allFalse, SPACE_ID)
    const undoneStep = undone.steps.find((s) => s.key === 'invite_team')!
    expect(undoneStep.href).toBe('/settings/members')
    expect(undoneStep.ctaLabel).not.toBeNull()

    const done = computeSetupChecklist({ ...allFalse, hasTeamInvite: true }, SPACE_ID)
    const doneStep = done.steps.find((s) => s.key === 'invite_team')!
    expect(doneStep.href).toBeNull()
    expect(doneStep.ctaLabel).toBeNull()
  })

  it('gives invite_client a CTA link to /settings/members when undone', () => {
    const result = computeSetupChecklist(allFalse, SPACE_ID)
    const step = result.steps.find((s) => s.key === 'invite_client')!
    expect(step.href).toBe('/settings/members')
  })

  it('gives publish_task no CTA link (in-page action) regardless of done state', () => {
    const undone = computeSetupChecklist(allFalse, SPACE_ID)
    expect(undone.steps.find((s) => s.key === 'publish_task')!.href).toBeNull()

    const done = computeSetupChecklist({ ...allFalse, hasPublishedTask: true }, SPACE_ID)
    expect(done.steps.find((s) => s.key === 'publish_task')!.href).toBeNull()
  })

  it('points preview_portal at /portal/preview/{spaceId} when undone', () => {
    const result = computeSetupChecklist(allFalse, 'my-space-42')
    const step = result.steps.find((s) => s.key === 'preview_portal')!
    expect(step.href).toBe('/portal/preview/my-space-42')
  })

  it('clears preview_portal CTA once previewed', () => {
    const result = computeSetupChecklist({ ...allFalse, hasPreviewedPortal: true }, SPACE_ID)
    const step = result.steps.find((s) => s.key === 'preview_portal')!
    expect(step.href).toBeNull()
    expect(step.done).toBe(true)
  })

  it('computes partial completion counts correctly', () => {
    const result = computeSetupChecklist(
      { ...allFalse, hasNonSampleTask: true, hasTeamInvite: true },
      SPACE_ID
    )
    expect(result.completedCount).toBe(2)
    expect(result.allDone).toBe(false)
  })

  it('marks allDone true only when every step is done', () => {
    const result = computeSetupChecklist(
      {
        hasNonSampleTask: true,
        hasTeamInvite: true,
        hasClientInvite: true,
        hasPublishedTask: true,
        hasPreviewedPortal: true,
      },
      SPACE_ID
    )
    expect(result.completedCount).toBe(5)
    expect(result.allDone).toBe(true)
    for (const step of result.steps) {
      expect(step.href).toBeNull()
    }
  })
})
