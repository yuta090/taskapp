import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'agentpm ｜ 本来の仕事に、戻ろう。',
  description:
    '催促、確認、リマインド、進行の管理。クライアントワークの「まわりの仕事」はagentpmが引き受けます。タスク管理＋雇えるAI秘書。',
  openGraph: {
    title: 'agentpm ｜ 本来の仕事に、戻ろう。',
    description:
      'クライアントワークの「まわりの仕事」を引き受ける、タスク管理＋雇えるAI秘書。',
  },
}

// 業種LPハブ（採番は docs/lp/INDUSTRY_LP_INDEX.md が正）
const INDUSTRIES = [
  { n: 1, tag: 'TAX', industry: '税理士・会計事務所', l1: '資料さえ、', accent: '揃', rest: 'えば。' },
  { n: 2, tag: 'LABOR', industry: '社労士事務所', l1: '勤怠さえ、', accent: '届', rest: 'けば。' },
  { n: 3, tag: 'BUILD', industry: '建設業の元請け', l1: '安全書類さえ、', accent: '揃', rest: 'えば。' },
  { n: 4, tag: 'LICENSING', industry: '行政書士事務所', l1: '必要書類さえ、', accent: '揃', rest: 'えば。' },
  { n: 5, tag: 'LEASING', industry: '賃貸管理会社', l1: '更新書類さえ、', accent: '戻', rest: 'れば。' },
  { n: 6, tag: 'REGISTRY', industry: '司法書士事務所', l1: '決済日さえ、', accent: '守', rest: 'れれば。' },
  { n: 7, tag: 'HR', industry: '人事・労務担当', l1: '入社日さえ、', accent: '間', rest: 'に合えば。' },
  { n: 8, tag: 'INSURANCE', industry: '保険代理店', l1: '意向確認さえ、', accent: '済', rest: 'めば。' },
]

const JOBS =
  '税理士 ◆ 社労士 ◆ 建設の元請け ◆ 行政書士 ◆ 賃貸管理 ◆ 司法書士 ◆ 人事・労務 ◆ 保険代理店 ◆ 受託開発 ◆ Web制作 ◆ 広告代理店 ◆ 設計事務所 ◆ コンサルタント ◆ '
const ITEMS =
  '領収書 ◆ 勤怠データ ◆ 安全書類 ◆ 更新契約書 ◆ 印鑑証明 ◆ 入社書類 ◆ 意向確認 ◆ 検収書 ◆ 原稿 ◆ 見積の承認 ◆ 議事録の確認 ◆ 素材データ ◆ '

const FEATURES = [
  {
    k: '01',
    t: 'いま、どっちの番か。',
    d: 'タスクごとに「ボール」の所在がひと目でわかる。相手待ちのまま放置される仕事が、なくなります。',
    name: 'ボール管理',
  },
  {
    k: '02',
    t: '相手は、ログイン不要。',
    d: 'クライアントはメールのリンクから、確認・承認・ファイル提出まで完了。相手に新しい道具を覚えさせません。',
    name: 'クライアントポータル',
  },
  {
    k: '03',
    t: '進みは、絵でわかる。',
    d: 'ガントチャートとバーンダウンで、遅れの兆しを先に掴む。報告資料づくりも要りません。',
    name: 'ガント・バーンダウン',
  },
  {
    k: '04',
    t: '「言った言わない」を、なくす。',
    d: '承認・レビュー・議事録・やり取りの履歴が、証跡として残る。引き継ぎとトラブルに強い進行台帳になります。',
    name: 'レビューと証跡',
  },
]

export default function Home() {
  return (
    <main className="top">
      <style>{`
.top{
  --shu:#E14A2B; --cream:#F4EDDE; --neon:#EFFF3C; --tq:#1FA79A; --sumi:#221D18; --soft:#6d6257;
  font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP",sans-serif;
  background:var(--cream); color:var(--sumi); line-height:1.9;
  font-feature-settings:"palt"; -webkit-font-smoothing:antialiased; overflow-x:hidden;
}
.top a{color:inherit}
.top .pin{max-width:1080px;margin:0 auto;padding:0 24px;position:relative}
.top .en{font-family:"Helvetica Neue",Arial,sans-serif;font-weight:700;letter-spacing:.32em;font-size:11px;text-transform:uppercase}
.top .btn{display:inline-block;background:var(--sumi);color:var(--cream);font-weight:800;font-size:15px;padding:16px 38px;text-decoration:none;border:2px solid var(--sumi);transition:all .18s ease}
.top .btn:hover{background:var(--shu);border-color:var(--shu);color:#fff;transform:translateY(-2px)}
.top .btn.ghost{background:transparent;color:var(--sumi)}
.top .btn.ghost:hover{background:var(--neon);color:var(--sumi);border-color:var(--sumi)}

/* header */
.top-head{display:flex;justify-content:space-between;align-items:center;max-width:1080px;margin:0 auto;padding:18px 24px}
.top-brand{font-weight:800;font-size:17px;letter-spacing:.14em;text-decoration:none}
.top-brand small{font-weight:600;color:var(--soft);letter-spacing:.1em;margin-left:10px;font-size:10px}
.top-nav{display:flex;gap:18px;align-items:center;font-size:13px;font-weight:700}
.top-nav a{text-decoration:none}
.top-nav a:hover{color:var(--shu)}
.top-nav .login{border:2px solid var(--sumi);padding:8px 18px}
.top-nav .login:hover{background:var(--sumi);color:var(--cream)}
@media(max-width:560px){.top-nav .hide-m{display:none}}

/* hero */
.top-hero{position:relative;padding:36px 0 0;overflow:hidden}
.top-hero .hwrap{display:grid;grid-template-columns:1fr;position:relative}
.top-hero .neon{position:absolute;border-radius:50%;width:min(52vw,380px);aspect-ratio:1;background:var(--neon);right:-12%;top:6%;z-index:0}
.top-hero .papers{position:absolute;width:min(44vw,300px);right:-6%;top:-2%;z-index:0;transform:rotate(8deg)}
.top-hero h1{position:relative;z-index:2;font-size:clamp(50px,12.2vw,108px);font-weight:800;line-height:1.06;letter-spacing:-.015em;white-space:nowrap}
.top-hero h1 .l2{display:block;margin-left:.55em}
.top-hero h1 .ac{color:var(--shu)}
.top-hero h1 .o{color:transparent;-webkit-text-stroke:clamp(1.6px,.3vw,3px) var(--sumi)}
.top-hero .duo{position:relative;z-index:1;width:min(78vw,350px);margin:clamp(-40px,-7vw,-18px) auto 0}
.top-hero .duo img{width:100%;display:block}
.top-hero .copy2{position:relative;z-index:2;margin-top:-10px;padding-bottom:40px}
.top-hero .lead{max-width:36em;font-size:15.5px;font-weight:500;margin-top:18px}
.top-hero .pillars{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px;font-weight:800;font-size:14px;letter-spacing:.06em}
.top-hero .pillars span{border:2px solid var(--sumi);padding:7px 16px;background:#fff}
.top-hero .pillars span.emph{background:var(--sumi);color:var(--neon)}
.top-hero .cta{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:30px}
.top-hero .note{font-size:12px;color:var(--soft)}
@media(min-width:900px){
  .top-hero{padding:48px 0 0}
  .top-hero .hwrap{grid-template-columns:1.05fr .95fr;align-items:end;min-height:560px}
  .top-hero h1{grid-column:1/-1;font-size:clamp(72px,8.6vw,104px)}
  .top-hero .duo{grid-column:2;grid-row:2;width:min(36vw,430px);margin:-120px 0 0;justify-self:end}
  .top-hero .copy2{grid-column:1;grid-row:2;align-self:start;margin-top:26px;padding-bottom:56px}
  .top-hero .neon{right:2%;top:10%}
  .top-hero .papers{right:-2%;top:4%}
}

/* double ticker */
.tick{border-top:3px solid var(--sumi);border-bottom:3px solid var(--sumi);overflow:hidden;white-space:nowrap;padding:9px 0;background:var(--neon)}
.tick+.tick{border-top:none;background:var(--cream)}
.tick-in{display:inline-block;font-weight:800;font-size:14px;letter-spacing:.12em}
.tick-a .tick-in{animation:tk 46s linear infinite}
.tick-b .tick-in{animation:tk 52s linear infinite reverse}
@keyframes tk{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@media(prefers-reduced-motion:reduce){.tick-in{animation:none!important}}

/* secretary hub */
.hub{background:var(--sumi);color:var(--cream);padding:76px 0 84px}
.hub .new{display:inline-block;background:var(--neon);color:var(--sumi);font-weight:800;font-size:12px;letter-spacing:.2em;padding:5px 14px;transform:rotate(-2deg)}
.hub h2{font-size:clamp(38px,8.4vw,84px);font-weight:800;line-height:1.12;margin-top:16px}
.hub h2 em{font-style:normal;color:var(--neon)}
.hub .lead{max-width:37em;font-size:15px;font-weight:500;margin-top:16px;color:#efe8da}
.hub-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:38px}
@media(min-width:768px){.hub-grid{grid-template-columns:repeat(4,1fr)}}
.top .hub-card{display:block;background:var(--cream);color:var(--sumi);text-decoration:none;padding:18px 16px 14px;border:2px solid var(--cream);transition:all .15s ease;position:relative}
.hub-card:hover{transform:translateY(-4px);border-color:var(--neon);box-shadow:0 10px 0 var(--shu)}
.hub-card .tag{font-family:"Helvetica Neue",Arial,sans-serif;font-size:9px;font-weight:700;letter-spacing:.24em;color:var(--soft)}
.hub-card .hook{display:block;font-size:17px;font-weight:800;line-height:1.5;margin-top:8px}
.hub-card .hook b{color:var(--shu)}
.hub-card .ind{display:block;font-size:11.5px;font-weight:700;color:var(--soft);margin-top:10px;border-top:1.5px solid var(--sumi);padding-top:8px}
.hub-card .arw{position:absolute;right:12px;bottom:10px;color:var(--shu);font-weight:800}
.hub-note{margin-top:22px;font-size:13px;color:#d8cfc0}
.hub-note a{color:var(--neon);font-weight:700}

/* original features */
.feat{background:var(--cream);padding:80px 0}
.feat h2{font-size:clamp(34px,7vw,64px);font-weight:800;line-height:1.2}
.feat h2 .o{color:transparent;-webkit-text-stroke:2px var(--sumi)}
.feat .lead{max-width:37em;font-size:15px;font-weight:500;margin-top:14px}
.feat-shots{position:relative;margin:40px 0 10px;padding-bottom:14%}
.feat-shots .sh{display:block;border:8px solid #fff;box-shadow:0 16px 40px rgba(34,29,24,.15)}
.feat-shots .sh1{width:94%;transform:rotate(-1.2deg)}
.feat-shots .sh2{position:absolute;width:64%;right:0;bottom:0;transform:rotate(1.6deg);box-shadow:0 20px 48px rgba(34,29,24,.22)}
@media(min-width:768px){.feat-shots .sh1{width:78%}.feat-shots .sh2{width:56%}}
.feat-shots .sh2::before{content:"";position:absolute;top:-16px;left:50%;transform:translateX(-50%) rotate(-3deg);width:92px;height:24px;background:var(--neon);opacity:.95}
.feat-shots .cap{position:absolute;left:0;bottom:-4px;font-family:"Helvetica Neue",Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:.28em;color:var(--soft)}
.feat-shots img{width:100%;display:block}
.feat-grid{display:grid;grid-template-columns:1fr;gap:14px;margin-top:36px}
@media(min-width:768px){.feat-grid{grid-template-columns:repeat(2,1fr)}}
.feat-card{background:#fff;border:2.5px solid var(--sumi);padding:24px 22px 20px;position:relative}
.feat-card .k{font-family:"Helvetica Neue",Arial,sans-serif;font-weight:800;color:var(--shu);font-size:13px;letter-spacing:.1em}
.feat-card h3{font-size:21px;font-weight:800;margin:8px 0 10px;line-height:1.5}
.feat-card p{font-size:13.5px;font-weight:500;color:#453b31}
.feat-card .nm{position:absolute;top:22px;right:18px;font-size:10.5px;font-weight:700;color:var(--soft);letter-spacing:.14em}
.feat-more{margin-top:24px;font-size:14px;font-weight:700}
.feat-more a{color:var(--shu)}

/* two ways */
.ways{background:var(--tq);color:#fff;padding:76px 0 84px}
.ways h2{font-size:clamp(32px,6.6vw,58px);font-weight:800;line-height:1.25}
.ways h2 span{color:var(--neon)}
.ways-grid{display:grid;grid-template-columns:1fr;gap:14px;margin-top:34px}
@media(min-width:768px){.ways-grid{grid-template-columns:1fr 1fr}}
.way{border:2.5px solid #fff;padding:26px 24px}
.way.alt{background:#fff;color:var(--sumi)}
.way .who{font-size:11.5px;font-weight:800;letter-spacing:.2em}
.way.alt .who{color:var(--shu)}
.way h3{font-size:22px;font-weight:800;margin:10px 0 10px}
.way p{font-size:14px;font-weight:500}

/* cta band */
.band{background:var(--shu);color:#fff;text-align:center;padding:64px 24px}
.band h2{font-size:clamp(30px,6.4vw,52px);font-weight:800;line-height:1.3}
.band .cta{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:26px}
.band .btn{background:#fff;color:var(--shu);border-color:#fff}
.band .btn:hover{background:var(--sumi);color:var(--cream);border-color:var(--sumi)}
.band .btn.ghost{background:transparent;color:#fff;border-color:#fff}
.band .note{font-size:12px;color:#ffd9cd;margin-top:16px}

/* footer */
.top-foot{background:var(--sumi);color:#d8cfc0;font-size:12px;padding:30px 0 36px}
.top-foot .pin{display:flex;flex-wrap:wrap;gap:10px 22px;justify-content:space-between;align-items:center}
.top-foot nav{display:flex;flex-wrap:wrap;gap:8px 18px}
.top-foot a{text-decoration:none}
.top-foot a:hover{color:var(--neon)}
      `}</style>

      {/* header */}
      <header className="top-head">
        <Link href="/" className="top-brand">
          agentpm<small>by skara</small>
        </Link>
        <nav className="top-nav">
          <Link href="/features" className="hide-m">機能</Link>
          <Link href="/pricing" className="hide-m">料金</Link>
          <Link href="/contact" className="hide-m">相談する</Link>
          <Link href="/login" className="login">ログイン</Link>
        </nav>
      </header>

      {/* hero */}
      <section className="top-hero">
        <div className="pin hwrap">
          <span className="neon" aria-hidden="true" />
          <img className="papers" src="/top-assets/hero-papers.png" alt="" aria-hidden="true" />
          <h1>
            本来の仕事に、
            <span className="l2">
              <span className="ac">戻</span>
              <span className="o">ろう。</span>
            </span>
          </h1>
          <figure className="duo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/top-assets/hero-duo.png" alt="書類の束を抱えたAI秘書と、鞄を手にした経営者" />
          </figure>
          <div className="copy2">
            <p className="lead">
              催促、確認、リマインド、進行の管理。クライアントワークの<b>「まわりの仕事」</b>は、agentpmが引き受けます。あなたと相手のあいだで止まっている仕事を、揃うまで追いかける。
            </p>
            <div className="pillars" aria-label="agentpmの二本柱">
              <span>タスク管理</span>
              <span className="emph">＋ 雇えるAI秘書</span>
            </div>
            <div className="cta">
              <Link href="/contact" className="btn">15分の相談から</Link>
              <Link href="/signup" className="btn ghost">無料で始める</Link>
            </div>
            <p className="note" style={{ marginTop: 12 }}>
              売り込みはしません——いまの進め方を伺い、合わなければ正直にそう申し上げます。
            </p>
          </div>
        </div>
      </section>

      {/* double ticker */}
      <div className="tick tick-a" aria-hidden="true">
        <div className="tick-in">
          <span>{JOBS}</span>
          <span>{JOBS}</span>
        </div>
      </div>
      <div className="tick tick-b" aria-hidden="true">
        <div className="tick-in">
          <span>{ITEMS}</span>
          <span>{ITEMS}</span>
        </div>
      </div>

      {/* AI secretary hub */}
      <section className="hub">
        <div className="pin">
          <span className="new">NEW — AI SECRETARY</span>
          <h2>
            回収・催促・証跡は、<br />
            <em>秘書を雇って</em>任せる。
          </h2>
          <p className="lead">
            相手からの「待ち」を追いかけるAI秘書が、あなたの名義で入社します。未着のリストアップから、角の立たない催促、受領の記録まで。あなたの業種のページで、実際の仕事ぶりをご覧ください。
          </p>
          <div className="hub-grid">
            {INDUSTRIES.map((i) => (
              <a key={i.n} href={`/lp${i.n}`} className="hub-card">
                <span className="tag">EDITION 0{i.n} — {i.tag}</span>
                <span className="hook">
                  {i.l1}
                  <br />
                  <b>{i.accent}</b>
                  {i.rest}
                </span>
                <span className="ind">{i.industry}</span>
                <span className="arw" aria-hidden="true">→</span>
              </a>
            ))}
          </div>
          <p className="hub-note">
            あなたの業種がありませんか？ <Link href="/contact">15分の相談</Link>で、貴社の「回収するもの」に合わせてご提案します。
          </p>
        </div>
      </section>

      {/* original features */}
      <section className="feat">
        <div className="pin">
          <span className="en" style={{ color: 'var(--shu)' }}>THE TOOL BEHIND</span>
          <h2 style={{ marginTop: 10 }}>
            秘書の裏には、<br />
            <span className="o">進行管理の本体。</span>
          </h2>
          <p className="lead">
            agentpmはもともと、受託開発・制作会社のためのクライアントワーク管理ツール。秘書が記録する先には、チームでそのまま使える進行管理があります。
          </p>
          <div className="feat-shots" aria-label="実際の画面">
            <span className="sh sh1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/top-assets/ui-dash.jpg" alt="プロジェクトダッシュボード。ボールの所在（社内/クライアント）と期限超過がひと目でわかる" loading="lazy" />
            </span>
            <span className="sh sh2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/top-assets/ui-portal.jpg" alt="クライアントポータル。相手はログイン不要で進捗確認と承認ができる" loading="lazy" />
            </span>
            <span className="cap">REAL SCREENS — BALL & CLIENT PORTAL</span>
          </div>
          <div className="feat-grid">
            {FEATURES.map((f) => (
              <div key={f.k} className="feat-card">
                <span className="k">{f.k}</span>
                <span className="nm">{f.name}</span>
                <h3>{f.t}</h3>
                <p>{f.d}</p>
              </div>
            ))}
          </div>
          <p className="feat-more">
            <Link href="/features">すべての機能を見る →</Link>
          </p>
        </div>
      </section>

      {/* two ways */}
      <section className="ways">
        <div className="pin">
          <h2>
            自分で回すもよし、<br />
            <span>任せて戻る</span>もよし。
          </h2>
          <div className="ways-grid">
            <div className="way">
              <span className="who">FOR DEV & CREATIVE TEAMS</span>
              <h3>ツールとして、自分で回す</h3>
              <p>
                受託開発・制作会社に。ボール管理とクライアントポータルで、チームの進行と顧客とのやり取りをひとつに。CLI・AI操作にも対応しています。
              </p>
            </div>
            <div className="way alt">
              <span className="who">FOR BUSY PROFESSIONALS</span>
              <h3>秘書に任せて、本業に戻る</h3>
              <p>
                士業・現場の会社に。画面はほとんど開かなくて大丈夫。回収と催促は秘書が実行し、あなたには週次の業務報告と、判断が要る例外だけが届きます。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* cta band */}
      <section className="band">
        <h2>
          まずは、いまの進め方を<br />聞かせてください。
        </h2>
        <div className="cta">
          <Link href="/contact" className="btn">15分の相談をする</Link>
          <Link href="/signup" className="btn ghost">無料で始める</Link>
        </div>
        <p className="note">先行導入のご相談は各業種ページからもどうぞ。</p>
      </section>

      {/* footer */}
      <footer className="top-foot">
        <div className="pin">
          <span>agentpm ｜ 運営: skara（クライアントワークのタスク管理＋AI秘書）</span>
          <nav>
            <Link href="/pricing">料金</Link>
            <Link href="/company">会社概要</Link>
            <Link href="/terms">利用規約</Link>
            <Link href="/privacy">プライバシー</Link>
            <Link href="/tokushoho">特定商取引法</Link>
            <Link href="/contact">お問い合わせ</Link>
          </nav>
          <span>© 2026 skara</span>
        </div>
      </footer>
    </main>
  )
}
