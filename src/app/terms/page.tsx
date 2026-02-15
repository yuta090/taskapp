'use client'

import React from 'react'
import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'

export default function TermsPage() {
    const date = '2026年2月15日'

    return (
        <div className="font-sans antialiased text-slate-900 bg-white">
            <LPHeader />
            <div className="container mx-auto px-6 py-32 max-w-4xl">
                <h1 className="text-3xl font-bold mb-8 text-slate-900 border-b border-slate-200 pb-4">利用規約</h1>

                <div className="prose prose-slate lg:prose-lg max-w-none text-slate-700">
                    <p className="lead text-xl text-slate-600 mb-8">
                        この利用規約（以下「本規約」といいます。）は、株式会社ソレカラ（以下「当社」といいます。）が提供するサービス「AgentPM」（以下「本サービス」といいます。）の利用条件を定めるものです。登録ユーザーの皆さま（以下「ユーザー」といいます。）には、本規約に従って、本サービスをご利用いただきます。
                    </p>

                    <h2 className="text-xl font-bold mt-8 mb-4">第1条（適用）</h2>
                    <ol className="list-decimal pl-6 space-y-2 mb-6">
                        <li>本規約は、ユーザーと当社との間の本サービスの利用に関わる一切の関係に適用されるものとします。</li>
                        <li>当社は本サービスに関し、本規約のほか、ご利用にあたってのルール等、各種の定め（以下「個別規定」といいます。）をすることがあります。これら個別規定はその名称のいかんに関わらず、本規約の一部を構成するものとします。</li>
                        <li>本規約の規定が前項の個別規定の規定と矛盾する場合には、個別規定において特段の定めなき限り、個別規定の規定が優先されるものとします。</li>
                    </ol>

                    <h2 className="text-xl font-bold mt-8 mb-4">第2条（利用登録）</h2>
                    <ol className="list-decimal pl-6 space-y-2 mb-6">
                        <li>本サービスにおいては、登録希望者が本規約に同意の上、当社の定める方法によって利用登録を申請し、当社がこれを承認することによって、利用登録が完了するものとします。</li>
                        <li>当社は、利用登録の申請者に以下の事由があると判断した場合、利用登録の申請を承認しないことがあり、その理由については一切の開示義務を負わないものとします。
                            <ul className="list-disc pl-6 mt-2 space-y-1">
                                <li>利用登録の申請に際して虚偽の事項を届け出た場合</li>
                                <li>本規約に違反したことがある者からの申請である場合</li>
                                <li>その他、当社が利用登録を相当でないと判断した場合</li>
                            </ul>
                        </li>
                    </ol>

                    <h2 className="text-xl font-bold mt-8 mb-4">第3条（ユーザーIDおよびパスワードの管理）</h2>
                    <p className="mb-6">ユーザーは自己の責任において、本サービスのユーザーIDおよびパスワードを適切に管理するものとします。</p>

                    <h2 className="text-xl font-bold mt-8 mb-4">第4条（利用料金および支払方法）</h2>
                    <ol className="list-decimal pl-6 space-y-2 mb-6">
                        <li>ユーザーは、本サービスの有料部分の対価として、当社が別途定め、本ウェブサイトに表示する利用料金を、当社が指定する方法により支払うものとします。</li>
                        <li>ユーザーが利用料金の支払を遅滞した場合には、ユーザーは年14.6％の割合による遅延損害金を支払うものとします。</li>
                    </ol>

                    <h2 className="text-xl font-bold mt-8 mb-4">第5条（禁止事項）</h2>
                    <p className="mb-4">ユーザーは、本サービスの利用にあたり、以下の行為をしてはなりません。</p>
                    <ul className="list-disc pl-6 space-y-2 mb-6">
                        <li>法令または公序良俗に違反する行為</li>
                        <li>犯罪行為に関連する行為</li>
                        <li>本サービスの内容等、本サービスに含まれる著作権、商標権ほか知的財産権を侵害する行為</li>
                        <li>当社、ほかのユーザー、またはその他第三者のサーバーまたはネットワークの機能を破壊したり、妨害したりする行為</li>
                        <li>本サービスの運営を妨害するおそれのある行為</li>
                        <li>不正アクセスをし、またはこれを試みる行為</li>
                    </ul>

                    <h2 className="text-xl font-bold mt-8 mb-4">第6条（本サービスの提供の停止等）</h2>
                    <p className="mb-6">当社は、以下のいずれかの事由があると判断した場合、ユーザーに事前に通知することなく本サービスの全部または一部の提供を停止または中断することができるものとします。</p>

                    <h2 className="text-xl font-bold mt-8 mb-4">第7条（免責事項）</h2>
                    <ol className="list-decimal pl-6 space-y-2 mb-6">
                        <li>当社の債務不履行責任は、当社の故意または重過失によらない場合には免責されるものとします。</li>
                        <li>当社は、本サービスに関して、ユーザーと他のユーザーまたは第三者との間において生じた取引、連絡または紛争等について一切責任を負いません。</li>
                    </ol>

                    <h2 className="text-xl font-bold mt-8 mb-4">第8条（サービス内容の変更等）</h2>
                    <p className="mb-6">当社は、ユーザーに通知することなく、本サービスの内容を変更し、または本サービスの提供を中止することができるものとし、これによってユーザーに生じた損害について一切の責任を負いません。</p>

                    <h2 className="text-xl font-bold mt-8 mb-4">第9条（利用規約の変更）</h2>
                    <p className="mb-6">当社は、必要と判断した場合には、ユーザーに通知することなくいつでも本規約を変更することができるものとします。</p>

                    <h2 className="text-xl font-bold mt-8 mb-4">第10条（個人情報の取扱い）</h2>
                    <p className="mb-6">当社は、本サービスの利用によって取得する個人情報については、当社「プライバシーポリシー」に従い適切に取り扱うものとします。</p>

                    <h2 className="text-xl font-bold mt-8 mb-4">第11条（準拠法・裁判管轄）</h2>
                    <ol className="list-decimal pl-6 space-y-2 mb-12">
                        <li>本規約の解釈にあたっては、日本法を準拠法とします。</li>
                        <li>本サービスに関して紛争が生じた場合には、当社の本店所在地を管轄する裁判所を専属的合意管轄とします。</li>
                    </ol>

                    <p className="text-right text-sm text-slate-500 mt-12 border-t pt-4">
                        制定日：{date}
                    </p>
                </div>
            </div>
            <LPFooter />
        </div>
    )
}
