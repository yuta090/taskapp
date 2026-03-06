import { describe, it, expect } from 'vitest'
import { buildTaskTree, isParentTask, getEligibleParents } from '@/lib/gantt/treeUtils'
import type { Task } from '@/types/database'

const createTask = (overrides: Partial<Task> & { id: string }): Task => ({
  org_id: 'org-1',
  space_id: 'space-1',
  title: `Task ${overrides.id}`,
  description: null,
  status: 'backlog',
  priority: null,
  assignee_id: null,
  start_date: null,
  due_date: null,
  milestone_id: null,
  ball: 'internal',
  origin: 'internal',
  type: 'task',
  spec_path: null,
  decision_state: null,
  client_scope: 'internal',
  actual_hours: null,
  parent_task_id: null,
  wiki_page_id: null,
  completed_at: null,
  created_at: '2024-01-15',
  updated_at: '2024-01-15',
  ...overrides,
})

describe('treeUtils', () => {
  describe('buildTaskTree', () => {
    it('should return flat list for tasks without parent-child relationships', () => {
      const tasks = [
        createTask({ id: 'a' }),
        createTask({ id: 'b' }),
        createTask({ id: 'c' }),
      ]

      const result = buildTaskTree(tasks)
      expect(result).toHaveLength(3)
      expect(result.map((n) => n.task.id)).toEqual(['a', 'b', 'c'])
      result.forEach((node) => {
        expect(node.children).toEqual([])
      })
    })

    it('should place children after their parent', () => {
      const tasks = [
        createTask({ id: 'parent' }),
        createTask({ id: 'child-1', parent_task_id: 'parent' }),
        createTask({ id: 'child-2', parent_task_id: 'parent' }),
        createTask({ id: 'standalone' }),
      ]

      const result = buildTaskTree(tasks)
      expect(result.map((n) => n.task.id)).toEqual([
        'parent',
        'child-1',
        'child-2',
        'standalone',
      ])
    })

    it('should compute summary dates from children', () => {
      const tasks = [
        createTask({ id: 'parent' }),
        createTask({ id: 'child-1', parent_task_id: 'parent', start_date: '2024-02-01', due_date: '2024-02-15' }),
        createTask({ id: 'child-2', parent_task_id: 'parent', start_date: '2024-01-15', due_date: '2024-03-01' }),
      ]

      const result = buildTaskTree(tasks)
      const parentNode = result[0]

      expect(parentNode.children).toHaveLength(2)
      expect(parentNode.summaryStart).toBe('2024-01-15')
      expect(parentNode.summaryEnd).toBe('2024-03-01')
    })

    it('should set summaryStart/End to null for tasks without children', () => {
      const tasks = [createTask({ id: 'solo', due_date: '2024-05-01' })]
      const result = buildTaskTree(tasks)

      expect(result[0].summaryStart).toBeNull()
      expect(result[0].summaryEnd).toBeNull()
    })

    it('should treat child with missing parent as top-level', () => {
      const tasks = [
        createTask({ id: 'orphan', parent_task_id: 'nonexistent' }),
      ]

      const result = buildTaskTree(tasks)
      expect(result).toHaveLength(1)
      expect(result[0].task.id).toBe('orphan')
      expect(result[0].children).toEqual([])
    })
  })

  describe('isParentTask', () => {
    it('should return true if task has children', () => {
      const tasks = [
        createTask({ id: 'parent' }),
        createTask({ id: 'child', parent_task_id: 'parent' }),
      ]
      expect(isParentTask('parent', tasks)).toBe(true)
    })

    it('should return false if task has no children', () => {
      const tasks = [
        createTask({ id: 'solo-1' }),
        createTask({ id: 'solo-2' }),
      ]
      expect(isParentTask('solo-1', tasks)).toBe(false)
    })

    it('should return false for child tasks', () => {
      const tasks = [
        createTask({ id: 'parent' }),
        createTask({ id: 'child', parent_task_id: 'parent' }),
      ]
      expect(isParentTask('child', tasks)).toBe(false)
    })
  })

  describe('getEligibleParents', () => {
    it('should return only top-level tasks (no parent_task_id)', () => {
      const tasks = [
        createTask({ id: 'parent' }),
        createTask({ id: 'child', parent_task_id: 'parent' }),
        createTask({ id: 'standalone' }),
      ]

      const eligible = getEligibleParents(tasks)
      expect(eligible.map((t) => t.id)).toEqual(['parent', 'standalone'])
    })

    it('should exclude the specified task', () => {
      const tasks = [
        createTask({ id: 'a' }),
        createTask({ id: 'b' }),
        createTask({ id: 'c' }),
      ]

      const eligible = getEligibleParents(tasks, 'b')
      expect(eligible.map((t) => t.id)).toEqual(['a', 'c'])
    })

    it('should return empty array when all tasks are children', () => {
      const tasks = [
        createTask({ id: 'child-1', parent_task_id: 'external-parent' }),
        createTask({ id: 'child-2', parent_task_id: 'external-parent' }),
      ]

      const eligible = getEligibleParents(tasks)
      expect(eligible).toEqual([])
    })
  })
})
