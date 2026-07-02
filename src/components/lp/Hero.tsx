'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect } from 'react'
import { ArrowRight, Play } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import Image from 'next/image'
import Link from 'next/link'

import { AuroraBackground } from '@/components/ui/aurora-background'

const heroImages = [
  "/img/lp/hero_dev_ai.webp",
  "/img/lp/hero_client_ai.webp"
]
const heroCaptions = [
  "普段使うAIからタスク操作",
  "自動でホウレンソウが完了!"
]

const metricBadges = [
  { label: '管理画面の操作', value: 'ゼロに' },
  { label: '進捗確認チャット', value: '-80%' },
  { label: 'タスク更新', value: 'AI自動' },
]

const personaAnchors = [
  { href: '#for-developers', label: 'エンジニア' },
  { href: '#for-clients', label: '発注者・クライアント' },
  { href: '#for-everyone', label: 'PM' },
  { href: '#for-agencies', label: '代理店' },
]

export function Hero() {
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentImageIndex((prev) => (prev + 1) % heroImages.length)
    }, 5000)
    return () => clearInterval(timer)
  }, [])

  return (
    <AuroraBackground className="min-h-[90vh] pt-24 pb-16">
      <div className="container mx-auto px-6 relative z-10 grid lg:grid-cols-2 gap-12 items-center flex-grow">
        {/* Left: Text Content */}
        <div className="space-y-8">
          <div className="inline-flex items-center justify-center -space-x-2 bg-slate-50 backdrop-blur border border-slate-200 rounded-full py-1 pl-1 pr-4 shadow-sm mb-6">
            <div className="bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">New</div>
            <span className="text-sm font-bold text-slate-700 pl-3">日本語ネイティブ x AI対応のPMクラウド</span>
          </div>

          <h1 className="text-3xl lg:text-5xl font-black text-slate-900 leading-[1.3] lg:leading-[1.2]">
            全員が、<br />
            <span className="text-amber-500 relative inline-block">
              本業に戻れる。
              <div className="absolute -top-4 -right-12 z-20">
                <span className="pen-stamp text-sm">圧倒的タイパ！</span>
              </div>
              <svg className="absolute w-full h-3 -bottom-1 left-0 text-amber-200 -z-10" viewBox="0 0 100 10" preserveAspectRatio="none">
                <path d="M0 5 Q 50 10 100 5" stroke="currentColor" strokeWidth="8" fill="none" />
              </svg>
            </span>
          </h1>

          <p className="text-base text-slate-600 leading-relaxed max-w-lg font-medium">
            開発者はAIで。クライアントはポータルで。代理店は一画面で。<br />
            余計な管理業務がなくなる<strong>プロジェクト管理クラウド</strong>。
          </p>

          {/* Metric Badges */}
          <div className="flex flex-wrap gap-3">
            {metricBadges.map((badge, i) => (
              <div key={i} className="glass-panel rounded-lg px-4 py-2">
                <div className="text-[10px] text-slate-500 font-medium">{badge.label}</div>
                <div className="text-lg font-black text-amber-600">{badge.value}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 pt-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Link
                  href="/signup"
                  className="btn-shine-effect px-8 py-4 bg-amber-500 text-white rounded-xl font-bold text-lg shadow-lg shadow-amber-500/30 flex items-center justify-center gap-2"
                >
                  無料で始める
                  <ArrowRight weight="bold" />
                </Link>
              </motion.div>
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Link
                  href="/contact"
                  className="px-8 py-4 bg-white text-slate-700 border border-slate-200 rounded-xl font-bold text-lg shadow-sm flex items-center justify-center gap-2 group"
                >
                  <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                    <Play weight="fill" size={12} />
                  </div>
                  3分デモ動画を見る
                </Link>
              </motion.div>
            </div>
            <div className="text-xs text-slate-500 flex items-center gap-4 pl-1">
              <span>&#10003; クレジットカード登録不要</span>
              <span>&#10003; 5分でスタート</span>
              <span>&#10003; いつでも解約可能</span>
            </div>
          </div>
        </div>

        {/* Right: Visual */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="relative"
        >
          <motion.div
            animate={{ y: [0, -20, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            className="relative z-20 bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-100 aspect-[4/3] flex items-center justify-center group"
          >
            <div className="relative w-full h-full flex items-center justify-center bg-white p-6">
              <AnimatePresence mode='wait'>
                <motion.div
                  key={currentImageIndex}
                  className="w-full h-full flex flex-col items-center justify-center relative z-10"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="relative w-full flex-1 max-h-[85%]">
                    <Image
                      src={heroImages[currentImageIndex]}
                      alt="AgentPM の機能紹介"
                      fill
                      className="object-contain"
                      sizes="(max-width: 1024px) 100vw, 50vw"
                      priority={currentImageIndex === 0}
                    />
                  </div>
                  <p className="text-lg lg:text-xl font-bold text-slate-700 mt-4 text-center">
                    {heroCaptions[currentImageIndex]}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-0">
              <AnimatePresence mode='wait'>
                <motion.div
                  key={currentImageIndex}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.2 }}
                  transition={{ duration: 0.3 }}
                  className={cn(
                    "font-black text-slate-200 leading-none select-none pointer-events-none",
                    currentImageIndex === 0
                      ? "text-[10rem] lg:text-[15rem] 2xl:text-[20rem] tracking-tighter"
                      : "text-[15rem] lg:text-[30rem] 2xl:text-[50rem] tracking-[0.2em]"
                  )}
                >
                  {currentImageIndex === 0 ? "TASK" : "AI"}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      </div>

      {/* Persona Anchors */}
      <div className="w-full mt-12 relative z-10 px-6">
        <div className="flex flex-wrap justify-center gap-3">
          {personaAnchors.map((anchor, i) => (
            <a
              key={i}
              href={anchor.href}
              className="glass-panel text-sm font-bold text-slate-600 px-5 py-2.5 rounded-full hover:border-amber-300 hover:text-amber-600 transition-colors"
            >
              {anchor.label} ↓
            </a>
          ))}
        </div>
      </div>

      {/* Social Proof */}
      <div className="w-full mt-8 text-center relative z-10 px-6 pb-24">
        <p className="text-xs font-bold text-slate-400 mb-6 tracking-wider">以下のようなチームでご利用いただいています</p>
        <div className="flex flex-wrap justify-center gap-4 opacity-80">
          {['システム受託開発', 'SaaSスタートアップ', 'Web制作・デザイン', 'コンサルティング', '社内DX推進チーム'].map((name, i) => (
            <span key={i} className="text-sm font-bold text-slate-600 bg-slate-50 px-5 py-2.5 rounded-full border border-slate-200">
              {name}
            </span>
          ))}
        </div>
      </div>

      {/* SVG Section Divider Bottom */}
      <div className="section-divider bottom">
        <svg viewBox="0 0 1200 120" preserveAspectRatio="none" style={{ width: '100%', height: '60px', fill: '#ffffff' }}>
          <path d="M1200 120L0 16.48V0h1200v120z"></path>
        </svg>
      </div>
    </AuroraBackground>
  )
}
