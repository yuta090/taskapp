'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowRight } from '@phosphor-icons/react'
import { motion, AnimatePresence } from 'framer-motion'

export function FloatingCTA() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > window.innerHeight * 0.8)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100 }}
          animate={{ y: 0 }}
          exit={{ y: 100 }}
          transition={{ duration: 0.3 }}
          className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.1)]"
          style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}
        >
          <Link
            href="/signup"
            className="flex items-center justify-center gap-2 w-full px-6 py-3.5 bg-amber-500 text-white font-bold rounded-xl shadow-lg shadow-amber-500/20 hover:bg-amber-600 transition-colors"
          >
            無料で始める
            <ArrowRight weight="bold" size={16} />
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
