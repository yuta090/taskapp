import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSampleTasks } from '@/lib/presets/sampleTasks'
import { getPreset, getBlankPreset } from '@/lib/presets'

const ORG_ID = 'org-1111'
const SPACE_ID = 'space-2222'
const USER_ID = 'user-9999'

interface MilestoneRow {
  id: string
  name: string
}

interface InsertedTaskRow {
  org_id: string
  space_id: string
  milestone_id: string | null
  title: string
  description: string
  status: string
  ball: string
  origin: string
  type: string
  client_scope: string
  due_date: string | null
  is_sample: boolean
  created_by: string
}

/** milestonesのselectとtasksのinsertだけを備えた偽Supabaseクライアント */
function makeFakeSupabase(options: {
  milestones: MilestoneRow[]
  failMilestoneSelect?: boolean
  failTaskInsert?: boolean
}) {
  const inserted: InsertedTaskRow[] = []

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'milestones') {
        return {
          select: () => ({
            eq: () =>
              options.failMilestoneSelect
                ? Promise.resolve({ data: null, error: new Error('milestone select failed') })
                : Promise.resolve({ data: options.milestones, error: null }),
          }),
        }
      }
      if (table === 'tasks') {
        return {
          insert: (rows: InsertedTaskRow[]) => {
            if (options.failTaskInsert) {
              return Promise.resolve({ error: new Error('task insert failed') })
            }
            inserted.push(...rows)
            return Promise.resolve({ error: null })
          },
        }
      }
      throw new Error(`unexpected table: ${table}`)
    }),
  }

  return { client: client as unknown as SupabaseClient, inserted }
}

describe('createSampleTasks', () => {
  it('プリセットのサンプルタスクをis_sample=trueで作成し、件数を返す', async () => {
    const preset = getPreset('design')
    const milestones: MilestoneRow[] = preset.milestones.map((m, i) => ({
      id: `ms-${i}`,
      name: m.name,
    }))
    const fake = makeFakeSupabase({ milestones })

    const count = await createSampleTasks(fake.client, preset, ORG_ID, SPACE_ID, USER_ID)

    expect(count).toBe(preset.sampleTasks.length)
    expect(fake.inserted).toHaveLength(preset.sampleTasks.length)
    for (const row of fake.inserted) {
      expect(row.is_sample).toBe(true)
      expect(row.org_id).toBe(ORG_ID)
      expect(row.space_id).toBe(SPACE_ID)
      expect(row.created_by).toBe(USER_ID)
      expect(row.type).toBe('task')
    }
  })

  it('milestoneNameを対応するmilestone_idに解決する', async () => {
    const preset = getPreset('design')
    const milestones: MilestoneRow[] = preset.milestones.map((m, i) => ({
      id: `ms-${i}`,
      name: m.name,
    }))
    const fake = makeFakeSupabase({ milestones })

    await createSampleTasks(fake.client, preset, ORG_ID, SPACE_ID, USER_ID)

    const withMilestone = preset.sampleTasks.filter(t => t.milestoneName)
    for (const task of withMilestone) {
      const row = fake.inserted.find(r => r.title === task.title)
      const expectedIndex = preset.milestones.findIndex(m => m.name === task.milestoneName)
      expect(row?.milestone_id).toBe(`ms-${expectedIndex}`)
    }
  })

  it('dueInDaysが設定されたタスクはdue_dateを持ち、無いタスクはnull', async () => {
    const preset = getPreset('design')
    const milestones: MilestoneRow[] = preset.milestones.map((m, i) => ({
      id: `ms-${i}`,
      name: m.name,
    }))
    const fake = makeFakeSupabase({ milestones })

    await createSampleTasks(fake.client, preset, ORG_ID, SPACE_ID, USER_ID)

    for (const task of preset.sampleTasks) {
      const row = fake.inserted.find(r => r.title === task.title)
      if (task.dueInDays !== undefined) {
        expect(row?.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      } else {
        expect(row?.due_date).toBeNull()
      }
    }
  })

  it('blankプリセット（サンプルタスク0件）は何もせず0を返す', async () => {
    const fake = makeFakeSupabase({ milestones: [] })
    const count = await createSampleTasks(fake.client, getBlankPreset(), ORG_ID, SPACE_ID, USER_ID)

    expect(count).toBe(0)
    expect(fake.inserted).toHaveLength(0)
  })

  it('milestone取得に失敗しても例外を投げず0を返す', async () => {
    const preset = getPreset('design')
    const fake = makeFakeSupabase({ milestones: [], failMilestoneSelect: true })

    const count = await createSampleTasks(fake.client, preset, ORG_ID, SPACE_ID, USER_ID)

    expect(count).toBe(0)
    expect(fake.inserted).toHaveLength(0)
  })

  it('task insertに失敗しても例外を投げず0を返す', async () => {
    const preset = getPreset('design')
    const milestones: MilestoneRow[] = preset.milestones.map((m, i) => ({
      id: `ms-${i}`,
      name: m.name,
    }))
    const fake = makeFakeSupabase({ milestones, failTaskInsert: true })

    const count = await createSampleTasks(fake.client, preset, ORG_ID, SPACE_ID, USER_ID)

    expect(count).toBe(0)
    expect(fake.inserted).toHaveLength(0)
  })
})
