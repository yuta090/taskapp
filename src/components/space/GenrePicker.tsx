'use client'

import {
  Globe,
  HardDrives,
  Palette,
  Briefcase,
  Megaphone,
  CalendarDots,
  FileText,
  Scales,
  FilmSlate,
  HardHat,
} from '@phosphor-icons/react'
import { getGenrePresets, getBlankPreset } from '@/lib/presets'
import type { PresetGenre, PresetDefinition } from '@/lib/presets'

// ---------------------------------------------------------------------------
// Icon Map (shared across SpaceCreateSheet, PresetApplicator, etc.)
// ---------------------------------------------------------------------------

export const ICON_MAP: Record<string, React.ReactNode> = {
  Globe: <Globe weight="duotone" />,
  Server: <HardDrives weight="duotone" />,
  Palette: <Palette weight="duotone" />,
  Briefcase: <Briefcase weight="duotone" />,
  Megaphone: <Megaphone weight="duotone" />,
  CalendarDays: <CalendarDots weight="duotone" />,
  FileText: <FileText weight="duotone" />,
  Scales: <Scales weight="duotone" />,
  FilmSlate: <FilmSlate weight="duotone" />,
  HardHat: <HardHat weight="duotone" />,
}

// ---------------------------------------------------------------------------
// GenrePicker — card grid for selecting a preset genre
// ---------------------------------------------------------------------------

interface GenrePickerProps {
  onSelect: (genre: PresetGenre) => void
  /** Include blank as a card in the grid. Default: false (shows blank as a separate text button). */
  includeBlankInGrid?: boolean
  /** Optional description text above the grid. */
  description?: string
}

export function GenrePicker({
  onSelect,
  includeBlankInGrid = false,
  description,
}: GenrePickerProps) {
  const genrePresets = getGenrePresets()
  const blankPreset = getBlankPreset()

  const allCards = includeBlankInGrid
    ? [...genrePresets, blankPreset]
    : genrePresets

  return (
    <div>
      {description && (
        <p className="text-sm text-gray-500 mb-4">{description}</p>
      )}

      <div className="grid grid-cols-3 gap-2.5 mb-4">
        {allCards.map((preset) => (
          <button
            key={preset.genre}
            type="button"
            onClick={() => onSelect(preset.genre)}
            title={preset.description}
            className="flex flex-col items-start gap-1 p-3 border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50/50 transition-all text-left group"
          >
            <span className="text-2xl text-indigo-600 group-hover:text-indigo-700">
              {ICON_MAP[preset.icon] || <FileText weight="duotone" />}
            </span>
            <span className="text-sm font-medium text-gray-900">
              {preset.label}
            </span>
            <span className="text-[10px] text-gray-400">
              Wiki {preset.wikiPages.length}件 / MS{' '}
              {preset.milestones.length}件
            </span>
          </button>
        ))}
      </div>

      {!includeBlankInGrid && (
        <button
          type="button"
          onClick={() => onSelect('blank')}
          className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
        >
          {blankPreset.label} — {blankPreset.description}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// GenrePreview — shows what the preset will create
// ---------------------------------------------------------------------------

interface GenrePreviewProps {
  preset: PresetDefinition
}

export function GenrePreview({ preset }: GenrePreviewProps) {
  if (preset.genre === 'blank') return null

  return (
    <div className="bg-gray-50 rounded-lg px-4 py-3 space-y-2">
      <p className="text-xs font-medium text-gray-500">作成されるもの</p>
      {preset.wikiPages.length > 0 && (
        <div className="flex items-start gap-2">
          <span className="text-xs text-gray-400 w-6 shrink-0">Wiki</span>
          <span className="text-xs text-gray-700">
            {preset.wikiPages.map((p) => p.title).join(', ')}
          </span>
        </div>
      )}
      {preset.milestones.length > 0 && (
        <div className="flex items-start gap-2">
          <span className="text-xs text-gray-400 w-6 shrink-0">MS</span>
          <span className="text-xs text-gray-700">
            {preset.milestones.map((m) => m.name).join(' → ')}
          </span>
        </div>
      )}
    </div>
  )
}
