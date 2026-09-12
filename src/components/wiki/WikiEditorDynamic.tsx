'use client'

import dynamic from 'next/dynamic'
import { EditorLoadingFallback } from '@/components/editor/EditorLoadingFallback'

export const WikiEditorDynamic = dynamic(
  () => import('./WikiEditor').then(mod => ({ default: mod.WikiEditor })),
  {
    ssr: false,
    loading: () => <EditorLoadingFallback />,
  }
)
