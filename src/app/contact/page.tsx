import { Metadata } from 'next'
import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'

export const metadata: Metadata = {
    title: 'お問い合わせ - AgentPM',
    description: 'AgentPMへのお問い合わせはこちらから。',
}

export default function ContactPage() {
    return (
        <main className="font-sans antialiased text-slate-900 bg-white min-h-screen flex flex-col">
            <LPHeader />
            <div className="h-16" />

            <div className="flex-grow container mx-auto px-6 py-24 text-center max-w-2xl">
                <h1 className="text-3xl font-bold mb-6">お問い合わせ</h1>
                <p className="text-slate-600 mb-8">
                    現在、お問い合わせフォームを準備中です。<br />
                    お急ぎの場合は <a href="mailto:support@taskapp.com" className="text-amber-600 hover:underline">support@taskapp.com</a> までご連絡ください。
                </p>
                <div className="bg-slate-50 p-8 rounded-2xl border border-slate-200">
                    <p className="text-sm text-slate-500">Form Placeholder</p>
                </div>
            </div>

            <LPFooter />
        </main>
    )
}
