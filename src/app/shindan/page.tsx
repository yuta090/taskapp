import Link from 'next/link'

// タスク滞留診断の入口 — 会社/個人の分岐
export default function ShindanIntroPage() {
  return (
    <div className="card">
      <h1>仕事のお困りごとを、その場で自己診断</h1>
      <p className="lead">
        「頼んだ仕事が動かない。締切の直前に慌てる。確認待ちで止まる——」。
        <br />
        思い当たるお困りごとに答えるだけで、仕事が止まりやすいタイプと、
        <br />
        どこから手を打てばいいかが分かります。
      </p>
      <p className="subnote">
        診断は無料。メールなしで結果まで見られます（詳しい解説だけメール登録）。
        <br />
        タスク管理サービス「AgentPM」と学びのメディア「TASK6」を運営する株式会社ソレカラが提供しています。
      </p>
      <div className="rolebtns">
        <Link className="rolebtn" href="/shindan/q?role=biz">
          <b>会社・チームを診断する</b>
          <span>経営者・管理職の方向け（17問・約5分）</span>
        </Link>
        <Link className="rolebtn" href="/shindan/q?role=self">
          <b>自分の仕事を診断する</b>
          <span>担当者・個人の方向け（13問・約3分）</span>
        </Link>
      </div>
      <p className="footer-note">
        <Link href="/task6">学びのメディア TASK6</Link>
        <span style={{ margin: '0 8px' }}>・</span>
        <Link href="/privacy">プライバシーポリシー</Link>
      </p>
    </div>
  )
}
