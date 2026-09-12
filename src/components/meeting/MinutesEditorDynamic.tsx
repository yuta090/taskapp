'use client'

import dynamic from 'next/dynamic'
import { EditorLoadingFallback } from '@/components/editor/EditorLoadingFallback'

export const MinutesEditorDynamic = dynamic(
  () => import('./MinutesEditor').then((mod) => ({ default: mod.MinutesEditor })),
  {
    ssr: false,
    loading: () => <EditorLoadingFallback />,
  }
)
