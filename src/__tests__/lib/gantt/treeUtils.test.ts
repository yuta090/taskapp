import { describe, it, expect } from 'vitest'
import {
  buildTaskTree,
  isParentTask,
  getEligibleParents,
  getDescendantIds,
  getAncestorIds,
} from '@/lib/gantt/treeUtils'
import type { Task } from '@/types/database'

/** Create a minimal mock Task for testing */
function mockTask(overrides: {
  id: string
  parent_task_id?: string | null
  start_date?: string | null
  due_date?: string | null
  title?: string
}): Task {
  return {
    id: overrides.id,
    title: overrides.title || `Task ${overrides.id}`,
    parent_task_id: overrides.parent_task_id ?? null,
    space_id: 'space1',
    org_id: 'org1',
    start_date: overrides.start_date ?? null,
    due_date: overrides.due_date ?? null,
    status: 'todo',
    ball: 'internal',
    origin: 'internal',
    type: 'task',
    client_scope: 'internal',
    priority: 0,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    description: null,
    milestone_id: null,
    completed_at: null,
    actual_hours: null,
    spec_path: null,
    decision_state: null,
    wiki_page_id: null,
    estimated_hours: null,
    assignee_id: null,
    estimated_cost: null,
    estimate_status: null,
  } as unknown as Task
}

describe('buildTaskTree', () => {
  it('should handle flat tasks (no hierarchy)', () => {
    const tasks = [mockTask({ id: 'a' }), mockTask({ id: 'b' }), mockTask({ id: 'c' })]
    const tree = buildTaskTree(tasks)

    expect(tree).toHaveLength(3)
    expect(tree.map((n) => n.task.id)).toEqual(['a', 'b', 'c'])
    expect(tree.every((n) => n.depth === 0)).toBe(true)
    expect(tree.every((n) => n.children.length === 0)).toBe(true)
  })

  it('should build 2-level hierarchy', () => {
    const tasks = [
      mockTask({ id: 'a' }),
      mockTask({ id: 'b', parent_task_id: 'a' }),
      mockTask({ id: 'c' }),
    ]
    const tree = buildTaskTree(tasks)

    expect(tree).toHaveLength(3)
    expect(tree[0].task.id).toBe('a')
    expect(tree[0].depth).toBe(0)
    expect(tree[0].children).toHaveLength(1)
    expect(tree[1].task.id).toBe('b')
    expect(tree[1].depth).toBe(1)
    expect(tree[2].task.id).toBe('c')
    expect(tree[2].depth).toBe(0)
  })

  it('should build 3-level hierarchy in correct order', () => {
    const tasks = [
      mockTask({ id: 'a' }),
      mockTask({ id: 'b', parent_task_id: 'a' }),
      mockTask({ id: 'c', parent_task_id: 'b' }),
      mockTask({ id: 'd', parent_task_id: 'a' }),
    ]
    const tree = buildTaskTree(tasks)

    // Expected order: A(0), B(1), C(2), D(1)
    expect(tree).toHaveLength(4)
    expect(tree.map((n) => ({ id: n.task.id, depth: n.depth }))).toEqual([
      { id: 'a', depth: 0 },
      { id: 'b', depth: 1 },
      { id: 'c', depth: 2 },
      { id: 'd', depth: 1 },
    ])
  })

  it('should treat orphan children as top-level', () => {
    const tasks = [
      mockTask({ id: 'a', parent_task_id: 'nonexistent' }),
      mockTask({ id: 'b' }),
    ]
    const tree = buildTaskTree(tasks)

    expect(tree).toHaveLength(2)
    expect(tree[0].task.id).toBe('a')
    expect(tree[0].depth).toBe(0)
  })

  it('should compute summary dates from all descendants', () => {
    const tasks = [
      mockTask({ id: 'a' }),
      mockTask({ id: 'b', parent_task_id: 'a', start_date: '2024-03-01', due_date: '2024-03-05' }),
      mockTask({ id: 'c', parent_task_id: 'b', start_date: '2024-03-03', due_date: '2024-03-10' }),
    ]
    const tree = buildTaskTree(tasks)

    // A's summary should include both B and C (grandchild)
    expect(tree[0].summaryStart).toBe('2024-03-01')
    expect(tree[0].summaryEnd).toBe('2024-03-10')

    // B's summary should include C only
    expect(tree[1].summaryStart).toBe('2024-03-03')
    expect(tree[1].summaryEnd).toBe('2024-03-10')
  })

  it('should handle empty tasks array', () => {
    const tree = buildTaskTree([])
    expect(tree).toHaveLength(0)
  })

  it('should rescue tasks in circular references as top-level', () => {
    // Corrupt data: A→B and B→A (both have parents in the list)
    const tasks = [
      mockTask({ id: 'a', parent_task_id: 'b' }),
      mockTask({ id: 'b', parent_task_id: 'a' }),
      mockTask({ id: 'c' }),
    ]
    const tree = buildTaskTree(tasks)
    // All 3 tasks should appear (A and B rescued as top-level)
    expect(tree).toHaveLength(3)
    expect(tree.map((n) => n.task.id).sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('getDescendantIds', () => {
  it('should return all descendants of a task', () => {
    const tasks = [
      mockTask({ id: 'a' }),
      mockTask({ id: 'b', parent_task_id: 'a' }),
      mockTask({ id: 'c', parent_task_id: 'b' }),
      mockTask({ id: 'd', parent_task_id: 'a' }),
      mockTask({ id: 'e' }),
    ]
    const ids = getDescendantIds('a', tasks)
    expect(ids).toEqual(new Set(['b', 'c', 'd']))
  })

  it('should return empty set for leaf task', () => {
    const tasks = [
      mockTask({ id: 'a' }),
      mockTask({ id: 'b', parent_task_id: 'a' }),
    ]
    const ids = getDescendantIds('b', tasks)
    expect(ids).toEqual(new Set())
  })

  it('should handle circular data without infinite loop', () => {
    // Simulate corrupt data: A → B → A (both point to each other as parent)
    const tasks = [
      mockTask({ id: 'a', parent_task_id: 'b' }),
      mockTask({ id: 'b', parent_task_id: 'a' }),
    ]
    // A's children (tasks with parent_task_id=A) = [B]
    // B's children (tasks with parent_task_id=B) = [A]
    // A is added because it's not yet in result set when B is processed
    // But loop terminates because A is then already in result
    const ids = getDescendantIds('a', tasks)
    expect(ids).toEqual(new Set(['b', 'a']))
  })
})

describe('getAncestorIds', () => {
  it('should return all ancestors of a task', () => {
    const tasks = [
      mockTask({ id: 'a' }),
      mockTask({ id: 'b', parent_task_id: 'a' }),
      mockTask({ id: 'c', parent_task_id: 'b' }),
    ]
    const ids = getAncestorIds('c', tasks)
    expect(ids).toEqual(new Set(['a', 'b']))
  })

  it('should return empty set for top-level task', () => {
    const tasks = [mockTask({ id: 'a' })]
    const ids = getAncestorIds('a', tasks)
    expect(ids).toEqual(new Set())
  })

  it('should handle circular data without infinite loop', () => {
    const tasks = [
      mockTask({ id: 'a', parent_task_id: 'b' }),
      mockTask({ id: 'b', parent_task_id: 'a' }),
    ]
    const ids = getAncestorIds('a', tasks)
    // Walk: a.parent=b (add b), b.parent=a (a is in visited set from initial add) → stop
    // But getAncestorIds starts visited check differently: it checks result.has(currentId)
    // a → parent=b → add b → b.parent=a → result has a? No. Add a → a.parent=b → result has b? Yes → break
    expect(ids).toEqual(new Set(['b', 'a']))
  })
})

describe('getEligibleParents', () => {
  it('should exclude self and descendants', () => {
    const tasks = [
      mockTask({ id: 'a' }),
      mockTask({ id: 'b', parent_task_id: 'a' }),
      mockTask({ id: 'c', parent_task_id: 'b' }),
      mockTask({ id: 'd' }),
    ]
    const eligible = getEligibleParents(tasks, 'a')
    expect(eligible.map((t) => t.id)).toEqual(['d'])
  })

  it('should return all tasks when no excludeTaskId', () => {
    const tasks = [mockTask({ id: 'a' }), mockTask({ id: 'b' })]
    const eligible = getEligibleParents(tasks)
    expect(eligible).toHaveLength(2)
  })

  it('should allow tasks with parents as eligible parents', () => {
    const tasks = [
      mockTask({ id: 'a' }),
      mockTask({ id: 'b', parent_task_id: 'a' }),
      mockTask({ id: 'c' }),
    ]
    // When creating/editing C, both A and B should be eligible parents
    const eligible = getEligibleParents(tasks, 'c')
    expect(eligible.map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('isParentTask', () => {
  it('should return true if task has children', () => {
    const tasks = [
      mockTask({ id: 'a' }),
      mockTask({ id: 'b', parent_task_id: 'a' }),
    ]
    expect(isParentTask('a', tasks)).toBe(true)
  })

  it('should return false if task has no children', () => {
    const tasks = [mockTask({ id: 'a' }), mockTask({ id: 'b' })]
    expect(isParentTask('a', tasks)).toBe(false)
  })
})
