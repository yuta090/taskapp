'use client'

import React from 'react'
import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'

export default function PrivacyPage() {
    const date = '2026年2月15日'

    return (
        <div className="font-sans antialiased text-slate-900 bg-white">
            <LPHeader />
            <div className="container mx-auto px-6 py-32 max-w-4xl">
                <h1 className="text-3xl font-bold mb-8 text-slate-900 border-b border-slate-200 pb-4">プライバシーポリシー</h1>

                <div className="prose prose-slate lg:prose-lg max-w-none text-slate-700">
                    <p className="lead text-xl text-slate-600 mb-8">
                        株式会社ソレカラ（以下「当社」といいます。）は、本ウェブサイト上で提供するサービス（以下「本サービス」といいます。）における、ユーザーの個人情報の取扱いについて、以下のとおりプライバシーポリシー（以下「本ポリシー」といいます。）を定めます。
                    </p>

                    <h2 className="text-xl font-bold mt-8 mb-4">第1条（個人情報）</h2>
                    <p className="mb-6">「個人情報」とは、個人情報保護法にいう「個人情報」を指すものとし、生存する個人に関する情報であって、当該情報に含まれる氏名、生年月日、住所、電話番号、連絡先その他の記述等により特定の個人を識別できる情報及び容貌、指紋、声紋にかかるデータ、及び健康保険証の保険者番号などの当該情報単体から特定の個人を識別できる情報（個人識別情報）を指します。</p>

                    <h2 className="text-xl font-bold mt-8 mb-4">第2条（個人情報の収集方法）</h2>
                    <p className="mb-6">当社は、ユーザーが利用登録をする際に氏名、生年月日、住所、電話番号、メールアドレス、銀行口座番号、クレジットカード番号などの個人情報をお尋ねすることがあります。また、ユーザーと提携先などとの間でなされたユーザーの個人情報を含む取引記録や決済に関する情報を、当社の提携先（情報提供元、広告主、広告配信先などを含みます。以下、｢提携先｣といいます。）などから収集することがあります。</p>

                    <h2 className="text-xl font-bold mt-8 mb-4">第3条（個人情報を収集・利用する目的）</h2>
                    <p className="mb-4">当社が個人情報を収集・利用する目的は、以下のとおりです。</p>
                    <ol className="list-decimal pl-6 space-y-2 mb-6">
                        <li>当社サービスの提供・運営のため</li>
                        <li>ユーザーからのお問い合わせに回答するため（本人確認を行うことを含む）</li>
                        <li>ユーザーが利用中のサービスの新機能、更新情報、キャンペーン等及び当社が提供する他のサービスの案内のメールを送付するため</li>
                        <li>メンテナンス、重要なお知らせなど必要に応じたご連絡のため</li>
                        <li>利用規約に違反したユーザーや、不正・不当な目的でサービスを利用しようとするユーザーの特定をし、ご利用をお断りするため</li>
                        <li>ユーザーにご自身の登録情報の閲覧や変更、削除、ご利用状況の閲覧を行っていただくため</li>
                        <li>有料サービスにおいて、ユーザーに利用料金を請求するため</li>
                        <li>上記の利用目的に付随する目的</li>
                    </ol>

                    <h2 className="text-xl font-bold mt-8 mb-4">第4条（利用目的の変更）</h2>
                    <ol className="list-decimal pl-6 space-y-2 mb-6">
                        <li>当社は、利用目的が変更前と関連性を有すると合理的に認められる場合に限り、個人情報の利用目的を変更するものとします。</li>
                        <li>利用目的の変更を行った場合には、変更後の目的について、当社所定の方法により、ユーザーに通知し、または本ウェブサイト上に公表するものとします。</li>
                    </ol>

                    <h2 className="text-xl font-bold mt-8 mb-4">第5条（個人情報の第三者提供）</h2>
                    <ol className="list-decimal pl-6 space-y-2 mb-6">
                        <li>当社は、次に掲げる場合を除いて、あらかじめユーザーの同意を得ることなく、第三者に個人情報を提供することはありません。ただし、個人情報保護法その他の法令で認められる場合を除きます。</li>
                        <li>前項の定めにかかわらず、次に掲げる場合には、当該情報の提供先は第三者に該当しないものとします。
                            <ul className="list-disc pl-6 mt-2 space-y-1">
                                <li>当社が利用目的の達成に必要な範囲内において個人情報の取扱いの全部または一部を委託する場合</li>
                                <li>合併その他の事由による事業の承継に伴って個人情報が提供される場合</li>
                            </ul>
                        </li>
                    </ol>

                    <h2 className="text-xl font-bold mt-8 mb-4">第6条（個人情報の開示・訂正・削除）</h2>
                    <p className="mb-6">当社は、本人から個人情報の開示を求められたときは、本人に対しこれを開示します。ただし、開示することにより本人または第三者の権利利益を害するおそれがある場合などは、その全部または一部を開示しないこともあります。</p>

                    <h2 className="text-xl font-bold mt-8 mb-4">第7条（プライバシーポリシーの変更）</h2>
                    <ol className="list-decimal pl-6 space-y-2 mb-6">
                        <li>本ポリシーの内容は、法令その他本ポリシーに別段の定めのある事項を除いて、ユーザーに通知することなく、変更することができるものとします。</li>
                        <li>当社が別途定める場合を除いて、変更後のプライバシーポリシーは、本ウェブサイトに掲載したときから効力を生じるものとします。</li>
                    </ol>

                    <h2 className="text-xl font-bold mt-8 mb-4">第8条（お問い合わせ窓口）</h2>
                    <p className="mb-6">本ポリシーに関するお問い合わせは、下記の窓口までお願いいたします。</p>

                    <div className="bg-slate-50 p-6 rounded-lg border border-slate-200">
                        <p className="mb-1"><strong>株式会社ソレカラ</strong></p>
                        <p className="mb-1">E-mail: support@agentpm.jp</p>
                    </div>

                    <p className="text-right text-sm text-slate-500 mt-12 border-t pt-4">
                        制定日：{date}
                    </p>
                </div>
            </div>
            <LPFooter />
        </div>
    )
}
