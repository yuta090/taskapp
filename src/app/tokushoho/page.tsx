import { Metadata } from 'next'
import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'

export const metadata: Metadata = {
    title: '特定商取引法に基づく表記 - AgentPM',
    description: '特定商取引法に基づく表記',
}

export default function TokushohoPage() {
    return (
        <main className="font-sans antialiased text-slate-900 bg-white min-h-screen flex flex-col">
            <LPHeader />
            <div className="h-16" />

            <div className="flex-grow container mx-auto px-6 py-24 max-w-3xl">
                <h1 className="text-3xl font-bold mb-12 text-center">特定商取引法に基づく表記</h1>

                <div className="space-y-8">
                    <dl className="divide-y divide-slate-200">
                        {[
                            { dt: '販売業者', dd: '株式会社Sorekara' },
                            { dt: '運営統括責任者', dd: '代表取締役' },
                            { dt: '所在地', dd: '東京都（詳細はお問い合わせください）' },
                            { dt: '電話番号', dd: 'お問い合わせフォームよりご連絡ください' },
                            { dt: 'メールアドレス', dd: 'support@agentpm.jp' },
                            { dt: '販売価格', dd: '各プランページに記載の通り（税込表示）' },
                            { dt: '支払い方法', dd: 'クレジットカード決済' },
                            { dt: '支払い時期', dd: '月額プラン：毎月自動課金 / 年額プラン：毎年自動課金' },
                            { dt: 'サービス提供時期', dd: 'お申込み後、即時ご利用いただけます' },
                            { dt: 'キャンセル・解約', dd: 'マイページからいつでも解約可能です。解約後も請求期間終了までご利用いただけます。' },
                            { dt: '返品・返金', dd: 'デジタルサービスの性質上、原則として返金はいたしかねます。ただし、サービスに重大な障害がある場合は個別に対応いたします。' },
                        ].map((item) => (
                            <div key={item.dt} className="py-4 sm:grid sm:grid-cols-3 sm:gap-4">
                                <dt className="text-sm font-bold text-slate-900">{item.dt}</dt>
                                <dd className="mt-1 text-sm text-slate-600 sm:col-span-2 sm:mt-0">{item.dd}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            </div>

            <LPFooter />
        </main>
    )
}
