/**
 * Project preset system — genre-based templates for wiki pages, milestones, and settings.
 * Presets are code-based (not DB-stored) following the existing defaultTemplate.ts pattern.
 */

import type { SpecPageRef } from '@/lib/wiki/defaultTemplate'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PresetGenre =
  | 'web_development'
  | 'system_development'
  | 'design'
  | 'consulting'
  | 'marketing'
  | 'event'
  | 'blank'

export interface PresetWikiPage {
  title: string
  tags: string[]
  /** Generate BlockNote JSON body. specPages available only for home page after spec pages are created. */
  generateBody: (orgId: string, spaceId: string, specPages?: SpecPageRef[]) => string
  /** If true, this is the home page that receives spec page links */
  isHome?: boolean
}

export interface PresetMilestone {
  name: string
  orderKey: number
}

export interface PresetDefinition {
  genre: PresetGenre
  label: string
  description: string
  icon: string // lucide-react icon name
  wikiPages: PresetWikiPage[]
  milestones: PresetMilestone[]
  recommendedIntegrations: string[]
  defaultSettings: {
    ownerFieldEnabled: boolean | null
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

import { webDevelopmentPreset } from './genres/web-development'
import { systemDevelopmentPreset } from './genres/system-development'
import { designPreset } from './genres/design'
import { consultingPreset } from './genres/consulting'
import { marketingPreset } from './genres/marketing'
import { eventPreset } from './genres/event'

const BLANK_PRESET: PresetDefinition = {
  genre: 'blank',
  label: '白紙から始める',
  description: 'テンプレートなしで自由にプロジェクトを構成',
  icon: 'FileText',
  wikiPages: [],
  milestones: [],
  recommendedIntegrations: [],
  defaultSettings: { ownerFieldEnabled: null },
}

const PRESET_MAP: Record<PresetGenre, PresetDefinition> = {
  web_development: webDevelopmentPreset,
  system_development: systemDevelopmentPreset,
  design: designPreset,
  consulting: consultingPreset,
  marketing: marketingPreset,
  event: eventPreset,
  blank: BLANK_PRESET,
}

/** Get a single preset by genre key */
export function getPreset(genre: PresetGenre): PresetDefinition {
  return PRESET_MAP[genre] ?? BLANK_PRESET
}

/** Get all presets (excluding blank) for the picker UI */
export function getGenrePresets(): PresetDefinition[] {
  return [
    webDevelopmentPreset,
    systemDevelopmentPreset,
    designPreset,
    consultingPreset,
    marketingPreset,
    eventPreset,
  ]
}

/** Get the blank preset */
export function getBlankPreset(): PresetDefinition {
  return BLANK_PRESET
}

/** All valid preset genre keys */
export const PRESET_GENRES: PresetGenre[] = [
  'web_development',
  'system_development',
  'design',
  'consulting',
  'marketing',
  'event',
  'blank',
]

export function isValidPresetGenre(value: string): value is PresetGenre {
  return PRESET_GENRES.includes(value as PresetGenre)
}
