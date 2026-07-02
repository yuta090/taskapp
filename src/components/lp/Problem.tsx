'use client'

import { motion } from 'framer-motion'
import { Code, ProjectorScreen, Handshake, Calculator, type IconProps } from '@phosphor-icons/react'

import { TornPaperSeparator, PixelSeparator } from './Separators'

type ProblemCardProps = {
  icon: React.ComponentType<IconProps>
  persona: string
  desc: string
  baloon: string
  delay: number
}

function ProblemCard({ icon: Icon, persona, desc, baloon, delay }: ProblemCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      whileHover={{ y: -8, scale: 1.02 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.5, delay, type: "spring", stiffness: 120 }}
      className="bg-white p-6 rounded-2xl shadow-lg border border-slate-100 flex flex-col items-start gap-3 relative group overflow-hidden"
    >
      {/* Baloon */}
      {baloon && (
        <motion.div
          initial={{ opacity: 0, scale: 0 }}
          whileInView={{ opacity: 1, scale: 1 }}
          transition={{ delay: delay + 0.5, type: "spring" }}
          className="absolute -top-10 -right-4 bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-xl rounded-bl-none shadow-lg z-20 whitespace-nowrap"
        >
          {baloon}
        </motion.div>
      )}

      {/* Background Icon */}
      <div className="absolute -right-6 -bottom-6 text-slate-100/50 transform rotate-12 group-hover:rotate-0 transition-transform duration-500 pointer-events-none select-none">
        <Icon size={140} weight="fill" />
      </div>

      <div className="relative z-10">
        <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center text-2xl mb-2 group-hover:bg-rose-500 group-hover:text-white transition-colors duration-300">
          <Icon weight="duotone" />
        </div>
        <div className="text-xs font-bold text-rose-400 uppercase tracking-wider mb-1">{persona}</div>
        <p className="text-sm text-slate-600 leading-relaxed">{desc}</p>
      </div>
    </motion.div>
  )
}

const problems = [
  {
    icon: Code,
    persona: '開発者',
    desc: '「Backlogを開いて、ステータス変えて、コメント書いて...コード書く時間が削られる」',
    baloon: 'また管理画面...!?',
  },
  {
    icon: ProjectorScreen,
    persona: 'PM',
    desc: '「進捗ヒアリング → Excel転記 → クライアント報告。同じ情報を3回書いている」',
    baloon: '週次報告書、今週もですか...',
  },
  {
    icon: Handshake,
    persona: '発注者',
    desc: '「今どこまで？聞かないとわからない。承認した記録もどこかにいった」',
    baloon: 'あの件、どうなりました？',
  },
  {
    icon: Calculator,
    persona: '代理店',
    desc: '「見積もりをExcelに転記、マージン計算、クライアント用に清書。全部手作業」',
    baloon: '原価率、合ってるよね...？',
  },
]

export function Problem() {
  return (
    <section className="py-20 bg-slate-50 relative overflow-hidden">
      <TornPaperSeparator position="top" color="fill-white" />

      <div className="absolute top-0 left-0 w-full h-20 bg-gradient-to-b from-slate-50 to-transparent z-10" />

      <div className="container mx-auto px-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center max-w-2xl mx-auto mb-16"
        >
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-rose-400 mb-3 block">Problem</span>
          <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-6 leading-[1.15]">
            プロジェクトに関わる全員が、<br />
            <span className="text-rose-500">「本業じゃないこと」</span>に追われている。
          </h2>
        </motion.div>

        {/* 4 Cards (2x2) */}
        <div className="grid sm:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {problems.map((p, i) => (
            <ProblemCard
              key={i}
              icon={p.icon}
              persona={p.persona}
              desc={p.desc}
              baloon={p.baloon}
              delay={i * 0.1}
            />
          ))}
        </div>
      </div>

      <PixelSeparator position="bottom" color="fill-white" />
    </section>
  )
}
