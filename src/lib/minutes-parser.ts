/**
 * Meeting Minutes Parser (AT-005)
 *
 * Parses markdown meeting minutes for SPEC lines and extracts task information.
 * Pattern: `- [ ] SPEC(/spec/FILE.md#anchor): title (期限: MM/DD, 担当: name)`
 *
 * Already-processed lines have marker: `<!--task:tXXX-->`
 */

export interface ParsedSpecLine {
  /** Original line number (0-indexed) */
  lineIndex: number
  /** Full original line text */
  originalLine: string
  /** Extracted spec_path (e.g., /spec/REVIEW_SPEC.md#meeting-minutes) */
  specPath: string
  /** Extracted title (text after colon) */
  title: string
  /** Due date if found (e.g., "02/15") */
  dueDate: string | null
  /** Assignee name if found */
  assignee: string | null
  /** Whether this line already has a task marker */
  hasMarker: boolean
  /** Existing task ID if marked */
  existingTaskId: string | null
}

export interface ParseMinutesResult {
  /** All parsed SPEC lines */
  specLines: ParsedSpecLine[]
  /** Only lines that need new tasks (no marker) */
  newSpecLines: ParsedSpecLine[]
  /** Lines with existing markers (skip) */
  existingSpecLines: ParsedSpecLine[]
}

/**
 * SPEC line regex pattern - UNCHECKED ONLY
 * Matches: `- [ ] SPEC(/spec/FILE.md#anchor): title`
 * NOTE: Only matches unchecked boxes [ ] - not [x] or [X]
 * Groups:
 *   1: spec_path (/spec/...#...)
 *   2: rest of line (title + optional metadata)
 */
const SPEC_LINE_REGEX = /^-\s*\[\s*\]\s*SPEC\(([^)]+)\):\s*(.+)$/

/**
 * Strict spec_path validation pattern
 * Must be: /spec/filename.ext#anchor (with content before and after #)
 */
const SPEC_PATH_PATTERN = /^\/spec\/[^#\s]+#\S+$/

/**
 * Task marker regex at end of line (allows trailing whitespace)
 * Matches: `<!--task:tXXX-->` optionally followed by whitespace
 */
const TASK_MARKER_REGEX = /<!--task:([^>]+)-->\s*$/

/**
 * Due date pattern in parentheses
 * Matches: `期限: MM/DD` or `期限: YYYY/MM/DD`
 */
const DUE_DATE_REGEX = /期限:\s*(\d{1,4}\/\d{1,2}\/?\d{0,2})/

/**
 * Assignee pattern in parentheses
 * Matches: `担当: name`
 */
const ASSIGNEE_REGEX = /担当:\s*([^)（）,、]+)/

/**
 * Parse a single line for SPEC task information
 * Only processes unchecked checkboxes [ ] - checked [x] are ignored
 */
export function parseSpecLine(line: string, lineIndex: number): ParsedSpecLine | null {
  const match = line.match(SPEC_LINE_REGEX)
  if (!match) return null

  // Groups: 1=spec_path, 2=rest (no checkbox group since we only match unchecked)
  const [, specPath, rest] = match

  // Strict spec_path validation: /spec/file.ext#anchor (non-empty before and after #)
  if (!SPEC_PATH_PATTERN.test(specPath)) {
    return null
  }

  // Check for existing task marker
  const markerMatch = rest.match(TASK_MARKER_REGEX)
  const hasMarker = !!markerMatch
  const existingTaskId = markerMatch ? markerMatch[1] : null

  // Remove marker from rest for title extraction
  const restWithoutMarker = rest.replace(TASK_MARKER_REGEX, '').trim()

  // Extract title (everything before parentheses with metadata)
  // Pattern: "title (期限: ..., 担当: ...)" or just "title"
  let title = restWithoutMarker
  const parenMatch = restWithoutMarker.match(/^(.+?)\s*（/)
  if (parenMatch) {
    title = parenMatch[1].trim()
  } else {
    // Also check for ASCII parentheses
    const asciiParenMatch = restWithoutMarker.match(/^(.+?)\s*\((?:期限|担当)/)
    if (asciiParenMatch) {
      title = asciiParenMatch[1].trim()
    }
  }

  // Extract due date
  const dueDateMatch = restWithoutMarker.match(DUE_DATE_REGEX)
  const dueDate = dueDateMatch ? dueDateMatch[1] : null

  // Extract assignee
  const assigneeMatch = restWithoutMarker.match(ASSIGNEE_REGEX)
  const assignee = assigneeMatch ? assigneeMatch[1].trim() : null

  return {
    lineIndex,
    originalLine: line,
    specPath,
    title,
    dueDate,
    assignee,
    hasMarker,
    existingTaskId,
  }
}

/**
 * Parse entire meeting minutes markdown
 */
export function parseMinutes(markdown: string): ParseMinutesResult {
  const lines = markdown.split('\n')
  const specLines: ParsedSpecLine[] = []

  lines.forEach((line, index) => {
    const parsed = parseSpecLine(line, index)
    if (parsed) {
      specLines.push(parsed)
    }
  })

  return {
    specLines,
    newSpecLines: specLines.filter((l) => !l.hasMarker),
    existingSpecLines: specLines.filter((l) => l.hasMarker),
  }
}

/**
 * Add task marker to a line
 * Preserves leading indentation (only trims trailing whitespace)
 */
export function addTaskMarker(line: string, taskId: string): string {
  // Remove any existing marker first (preserving leading indentation)
  const cleanLine = line.replace(TASK_MARKER_REGEX, '').trimEnd()
  return `${cleanLine} <!--task:${taskId}-->`
}

/**
 * Update markdown with task markers for newly created tasks
 *
 * @param markdown - Original markdown
 * @param taskMappings - Map of lineIndex to taskId
 * @returns Updated markdown with markers
 */
export function updateMinutesWithMarkers(
  markdown: string,
  taskMappings: Map<number, string>
): string {
  const lines = markdown.split('\n')

  taskMappings.forEach((taskId, lineIndex) => {
    if (lineIndex >= 0 && lineIndex < lines.length) {
      lines[lineIndex] = addTaskMarker(lines[lineIndex], taskId)
    }
  })

  return lines.join('\n')
}

/**
 * Convert extracted due date to ISO date string (YYYY-MM-DD)
 * Handles: "02/15", "2024/02/15", "2/15"
 *
 * IMPORTANT: Uses local date formatting, NOT toISOString() which causes timezone issues
 * (See CLAUDE.md: toISOString() は使用禁止)
 */
export function parseDueDateToISO(dueDate: string, referenceYear?: number): string | null {
  if (!dueDate) return null

  const parts = dueDate.split('/')
  const now = new Date()
  const year = referenceYear ?? now.getFullYear()

  let targetYear: number
  let month: number
  let day: number

  if (parts.length === 2) {
    // MM/DD format
    month = parseInt(parts[0], 10)
    day = parseInt(parts[1], 10)
    if (isNaN(month) || isNaN(day)) return null

    // Assume reference year, or next year if date has passed (only when no reference year provided)
    targetYear = year
    if (referenceYear === undefined) {
      const testDate = new Date(year, month - 1, day)
      if (testDate < now) {
        targetYear = year + 1
      }
    }
  } else if (parts.length === 3) {
    // YYYY/MM/DD format
    targetYear = parseInt(parts[0], 10)
    month = parseInt(parts[1], 10)
    day = parseInt(parts[2], 10)
    if (isNaN(targetYear) || isNaN(month) || isNaN(day)) return null
  } else {
    return null
  }

  // Validate date ranges
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  if (targetYear < 1900 || targetYear > 2100) return null

  // Validate actual date (handles months with <31 days and leap years)
  const testDate = new Date(targetYear, month - 1, day)
  if (
    testDate.getFullYear() !== targetYear ||
    testDate.getMonth() !== month - 1 ||
    testDate.getDate() !== day
  ) {
    return null // Invalid date (e.g., Feb 30)
  }

  // Format as YYYY-MM-DD using local values (not UTC)
  const paddedMonth = month.toString().padStart(2, '0')
  const paddedDay = day.toString().padStart(2, '0')
  return `${targetYear}-${paddedMonth}-${paddedDay}`
}
