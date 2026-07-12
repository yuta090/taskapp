#!/usr/bin/env python3
"""業種別LPジェネレータ（エディトリアル版）。

public/lp1/index.html（2026-07-12刷新のエディトリアル版・税理士＝正）をテンプレートに、
クラシック版ジェネレータ scripts/build-industry-lps.py の INDUSTRIES 辞書から
語彙を自動変換して public/lp2〜lp8 を生成する。
lp2 はクラシック辞書に存在しないため、凍結テンプレート（lp1-classic-template.html）を
正規表現化して public/lp2 の現行HTMLから値を逆抽出する。

写真は共有 public/lp-assets/ed-*.jpg を参照する（lp1のみ /lp1/images/ の実体を使う）。

使い方:  python3 scripts/build-editorial-lps.py
新業種の追加: build-industry-lps.py に業種辞書を1つ足せば、本スクリプトが
エディトリアル版に変換して生成する（採番は docs/lp/INDUSTRY_LP_INDEX.md が正）。
"""
import os, re, sys, importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'public/lp1/index.html')

# ---- クラシック版の辞書・KEYS を読み込む ----
spec = importlib.util.spec_from_file_location('classic', os.path.join(ROOT, 'scripts/build-industry-lps.py'))
classic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(classic)
INDUSTRIES = dict(classic.INDUSTRIES)
CLASSIC_KEYS = classic.KEYS

# ---- lp2 をクラシック凍結テンプレートから逆抽出 ----
def extract_lp2():
    tpl = open(os.path.join(ROOT, 'scripts/lp1-classic-template.html'), encoding='utf-8').read()
    # lp2の生成後は public/lp2 がエディトリアル版に置き換わるため、凍結コピーから抽出する
    html = open(os.path.join(ROOT, 'scripts/lp2-classic.html'), encoding='utf-8').read()
    html = html.replace('/lp2/images/', '/lp1/images/')
    pat = re.escape(tpl)
    for key, exact in CLASSIC_KEYS:
        pat = pat.replace(re.escape(exact), f'(?P<{key}>.*?)', 1)
    m = re.fullmatch(pat, html, re.S)
    assert m, 'lp2: クラシックテンプレートと構造が一致しない（逆抽出失敗）'
    d = m.groupdict()
    d['FORBIDDEN'] = ['税理士', '会計事務所', '記帳', '通帳', '領収書', '/lp1/']
    return d

INDUSTRIES = {'lp2': extract_lp2(), **INDUSTRIES}

# ---- 業種ごとの固定マップ ----
EDITION = {'lp2': 'LABOR', 'lp3': 'BUILD', 'lp4': 'LICENSING',
           'lp5': 'LEASING', 'lp6': 'REGISTRY', 'lp7': 'HR', 'lp8': 'INSURANCE'}
AITE = {'lp2': '顧問先', 'lp3': '協力会社', 'lp4': '依頼者', 'lp5': '入居者・オーナー',
        'lp6': '依頼者', 'lp7': '内定者', 'lp8': '契約者'}

strip_tags = lambda s: re.sub(r'<[^>]+>', '', s).strip()

def fs(maxlen, vw_base, px_base, mn_base, budget_vw, budget_px, budget_mn):
    """行の文字数に応じて h2/h1 の font-size style を返す（短ければ空=既定サイズ）"""
    vw = min(vw_base, budget_vw / maxlen)
    px = min(px_base, budget_px // maxlen)
    mn = min(mn_base, budget_mn // maxlen)
    if vw >= vw_base - 0.01:
        return ''
    return f' style="font-size:clamp({mn}px,{vw:.1f}vw,{px}px)"'

def mstyle_css(style_attr):
    """fs()の style 属性から margin-top と合成するための css断片を取り出す"""
    m = re.search(r'font-size:[^"]+', style_attr)
    return ';' + m.group(0) if m else ''

def build_replacements(lp, d):
    """(lp1内の完全一致文字列, 置換後, 期待出現回数) のリストを返す"""
    R = []

    # --- 生成LP共通の微調整（lp1は据え置き） ---
    R.append(('.hero-brand{font-weight:800;font-size:14px;letter-spacing:.18em}',
              '.hero-brand{font-weight:800;font-size:14px;letter-spacing:.18em;white-space:nowrap}', 1))
    R.append(('.hero-cta{\n  position:relative;z-index:5;text-align:center;\n  margin-top:clamp(-46px,-4vw,-16px);padding:0 24px 26px;\n}',
              '.hero-cta{\n  position:relative;z-index:5;text-align:center;\n  margin-top:6px;padding:0 24px 26px;\n}', 1))

    # --- head ---
    R.append(('<title>資料さえ、揃えば。｜ 税理士・会計事務所のためのAI秘書</title>', d['TITLE'], 1))
    R.append(('<meta name="description" content="税理士・会計事務所の資料回収と催促を、AI秘書が事務所の一員として引き受けます。顧問先はいつものLINEやメールに返信するだけ。先行導入5事務所を募集中。">', d['MDESC'], 1))
    R.append(('<meta property="og:title" content="資料さえ、揃えば。｜ 税理士・会計事務所のためのAI秘書">', d['OGT'], 1))
    R.append(('<meta property="og:description" content="顧問先からの資料回収・催促・証跡を、AI秘書がまるごと引き受けます。相手はLINEに写真を返信するだけ。">', d['OGD'], 1))

    # --- hero ---
    R.append(('EDITION 01 — TAX', 'EDITION 01 — ' + EDITION[lp], 1))
    eyebrow = strip_tags(d['EYEBROW'])
    m = re.fullmatch(r'(.+)のための AI秘書', eyebrow)
    assert m, f'{lp}: EYEBROW形式不一致: {eyebrow}'
    R.append(('<span class="hero-tate">税理士・会計事務所のための、AI秘書。</span>',
              f'<span class="hero-tate">{m.group(1)}のための、AI秘書。</span>', 1))

    h1m = re.fullmatch(r'<h1>(.+)<br>(.+)。<span class="stamp".*', d['H1'], re.S)
    assert h1m, f'{lp}: H1形式不一致'
    line1, line2 = h1m.group(1), h1m.group(2) + '。'
    style = fs(max(len(line1), len(line2) + 1), 16.5, 170, 64, 84, 960, 340)
    R.append(('<h1>資料さえ、<span class="l2"><span class="soro">揃</span><span class="o">えば。</span><span class="stamp" aria-hidden="true">受領</span></span></h1>',
              f'<h1{style}>{line1}<span class="l2"><span class="soro">{line2[0]}</span><span class="o">{line2[1:]}</span><span class="stamp" aria-hidden="true">受領</span></span></h1>', 1))

    unit = re.search(r'5(事務所|社)', strip_tags(d['FINEYE'])).group(0)
    R.append(('<p class="note">先行導入は5事務所限定 ｜ まずは15分のオンライン相談から</p>',
              f'<p class="note">先行導入は{unit}限定 ｜ まずは15分のオンライン相談から</p>', 1))

    # --- ticker（同一ブロックが2回出現） ---
    items = []
    for wk in ['W1', 'W2', 'W3', 'W4']:
        wm = re.search(r'<span class="what">(.*?)</span>\s*<span class="wait-days">(\d+)日<small>(.*?)</small>', d[wk], re.S)
        assert wm, f'{lp}: {wk}形式不一致'
        items.append(f'<span>◆ {wm.group(1)} ── {wm.group(2)}日・{wm.group(3)}</span>')
    R.append(('<span>◆ 通帳コピー ── 14日待ち・催促2回</span><span>◆ 経費領収書 ── 既読のまま9日</span><span>◆ 給与データ ── 電話つながらず21日</span><span>◆ 「明日送る」×2 ── 6日経過</span>',
              ''.join(items), 2))

    # --- pain ---
    hours = re.search(r'月(\d+)時間', d['MROW1'])
    assert hours, f'{lp}: MROW1に月N時間がない'
    R.append(('<span class="nw">月<span class="num">25</span>時間。</span>',
              f'<span class="nw">月<span class="num">{hours.group(1)}</span>時間。</span>', 1))
    R.append(('<p class="pain-sub">「催促」は連絡を1通送って終わりではありません。未着の洗い出しから受領の記録まで、顧問先1社あたり月30分——50社なら月25時間。繁忙期には、これが全顧問先で同時に起きます。</p>',
              f'<p class="pain-sub">{strip_tags(d["PAINLEAD"])}{strip_tags(d["LCLOSE"])}</p>', 1))
    R.append(('alt="山積みの領収書に埋もれ、受話器を握る所長"',
              'alt="山積みの書類に埋もれ、受話器を握る担当者"', 1))

    loops = []
    for k in ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']:
        b = re.search(r'<b>(.*?)</b>', d[k], re.S).group(1)
        loops.append(f'    <li><b>{b}</b></li>')
    R.append(('''    <li><b>未着リストを作る</b></li>
    <li><b>文面に悩み、連絡する</b></li>
    <li><b>届いた中身を確認する</b></li>
    <li><b>不足分を、再依頼する</b></li>
    <li><b>受領を記録して、引き継ぐ</b></li>
    <li><b>期限が近づき、また催促</b></li>''', '\n'.join(loops), 1))

    # --- sol ---
    solpara = d['SOLPARA'].replace('——LINE・メール・Chatwork・Slack・Google Chat——', '')
    R.append(('<p>新しいシステムの操作は覚えなくて大丈夫。事務所に「回収係の秘書」がひとり入社する、と考えてください。秘書は顧問先ごとの未着を把握し、相手のいる場所へ出向いて、角の立たない言葉で、揃うまで追いかけます。顧問先に見えるのは<b>「〇〇会計事務所の秘書」</b>——事務所の顔として働きます。</p>',
              solpara, 1))

    # --- exp ---
    em = re.fullmatch(r'<h3>(.+)<br>(.+)</h3>', d['MOCKH3'].strip(), re.S)
    assert em, f'{lp}: MOCKH3形式不一致'
    l1, l2 = em.group(1), em.group(2)
    style = fs(max(len(l1), len(l2)), 10.5, 110, 46, 88, 960, 340)
    R.append(('<h2>顧問先は、<br><span class="mk">写真を返すだけ。</span></h2>',
              f'<h2{style}>{l1}<br><span class="mk">{l2}</span></h2>', 1))
    R.append(('alt="窓辺の明るい机で、レシートをスマートフォンで撮る手元"',
              'alt="窓辺の明るい机で、書類をスマートフォンで撮る手元"', 1))

    bub3 = strip_tags(d['BUB3']).replace('\n', '')
    sentences = re.findall(r'[^。]*。', bub3)
    quote = ''.join(sentences[:2])
    R.append(('「お写真ありがとうございます。領収書24枚、確かにお預かりしました。」\n      <small>—— 秘書から顧問先へ、実際のトーンで</small>',
              f'「{quote}」\n      <small>—— 秘書から{AITE[lp]}へ、実際のトーンで</small>', 1))

    pil1_first = strip_tags(d['PIL1']).split('。')[0]
    mockli2 = strip_tags(d['MOCKLI2'])
    R.append(('''      <li>領収書は、撮って返信するだけで受領</li>
      <li>秘書が枚数と中身を確認し、記録します</li>
      <li>既読を確認しながら、適切な間隔で何度でも</li>
      <li>文面を考えるのは秘書の仕事。先生はゼロ分</li>''',
              f'''      <li>{pil1_first}を回収</li>
      <li>{mockli2}</li>
      <li>既読を確認しながら、適切な間隔で何度でも</li>
      <li>文面を考えるのは秘書の仕事。悩む時間はゼロに</li>''', 1))

    # --- math ---
    mm = re.fullmatch(r'<h2>(.+)<br>(.+)</h2>', d['MATHH2'].strip(), re.S)
    assert mm, f'{lp}: MATHH2形式不一致'
    mstyle = fs(max(len(mm.group(1)), len(mm.group(2))), 7.6, 60, 34, 88, 580, 330)
    R.append(('<h2 style="margin-top:12px"><span class="nw">月給は、</span><br><span class="nw">顧問先<em>1社分</em>の</span><br><span class="nw">顧問料以下。</span></h2>',
              f'<h2 style="margin-top:12px{mstyle_css(mstyle)}"><span class="nw">{mm.group(1)}</span><br><span class="nw">{mm.group(2)}</span></h2>', 1))

    def conv_row(row_html, tail_note=None):
        spans = re.findall(r'<span( class="(?:big|muted)")?>(.*?)</span>', row_html, re.S)
        bigs = [i for i, (c, _) in enumerate(spans) if 'big' in c]
        out = []
        for i, (cls, text) in enumerate(spans):
            if 'big' in cls:
                neon = ' neon-t' if i == bigs[-1] else ''
                out.append(f'<span class="big jp{neon}">{text}</span>')
            elif 'muted' in cls:
                out.append(f'<span class="u" style="flex-basis:100%">{text}</span>')
            else:
                out.append(f'<span class="u">{text}</span>')
        return '<div class="mrow">' + ''.join(out) + '</div>'

    new_rows = ('      ' + conv_row(d['MROW1']) + '\n        ' + conv_row(d['MROW2'])
                + '\n        ' + conv_row(d['MROW3']))
    R.append(('''      <div class="mrow"><span class="u">回収の一連が</span><span class="nw"><span class="big jp">1社 月30分</span><span class="u"> × </span><span class="big">50</span><span class="u">社</span></span><span class="nw"><span class="u">=</span> <span class="big neon-t">25</span><span class="u neon-t">時間/月</span></span><span class="u" style="flex-basis:100%">≒ 月4.5万円分の事務作業が、秘書の職務に</span></div>
        <div class="mrow"><span class="u">空いた手で 顧問先</span><span class="nw"><span class="big">+5</span><span class="u">社</span></span><span class="u">なら、顧問料 月3万円 × 5社</span><span class="nw"><span class="u">=</span> <span class="big neon-t">15</span><span class="u neon-t">万円/月</span></span><span class="u" style="flex-basis:100%">の増収余地が生まれる</span></div>''',
              new_rows, 1))
    R.append(('<p class="math-note" style="margin-top:22px">これは事務コストの削減だけの話ではありません。事務員の採用がむずかしいこの業界で、「もう一人採れないから顧問先を増やせない」への答えです。月給は先行導入の事務所と一緒に決めます。</p>',
              f'<p class="math-note" style="margin-top:22px">{strip_tags(d["MNOTE"])}</p>', 1))

    # --- rep ---
    repintro = strip_tags(d['REPINTRO']).replace('任せきりのブラックボックス', 'ブラックボックス')
    R.append(('<p class="rep-lead">ブラックボックスにはしません。秘書は毎週、事務所に業務報告を上げます。AIで拾いきれない例外——長期の未反応、こじれそうな相手——だけが、先生の判断に上がってきます。</p>',
              f'<p class="rep-lead">{repintro}</p>', 1))
    role = re.search(r'AI秘書 → (.*?) ｜', strip_tags(d['REPFROM'])).group(1)
    R.append(('alt="青空の見える窓辺で、お茶を手にくつろぐ所長"',
              f'alt="青空の見える窓辺で、お茶を手にくつろぐ{role}"', 1))
    R.append(('<span class="from">AI秘書 → 所長 ｜ 週次業務報告（4月第2週）</span>', d['REPFROM'], 1))
    R.append(('<p class="body">今週は催促を<b>14件</b>行い、<b>9件</b>を回収しました。未回収3件のうち、㈱丸山工務店さまは2週間ご反応がありません。トーンを変えた再送も既読のままのため、<b>先生から一度お電話いただくのが良さそうです</b>。他2件は「今週中に送る」とお返事をいただいており、金曜まで秘書側で追いかけます。</p>',
              d['REPBODY'], 1))

    # --- faq ---
    faqh = strip_tags(d['FAQH2'])
    prefix = faqh.split('、')[0]
    R.append(('<h2 class="rv">先生方から、<span>必ず</span>聞かれること。</h2>',
              f'<h2 class="rv">{prefix}、<span>必ず</span>聞かれること。</h2>', 1))
    R.append(('<summary>顧問先に、AIからの連絡は失礼にならないか。</summary>', d['F1S'], 1))
    R.append(('<p class="a">秘書は最初のご挨拶で「AI秘書です」と名乗ります。隠さないからこそ、深夜の送信も繰り返しの催促も角が立ちません。文面は「詰めない・責めない・事実と期限だけ」を原則に設計しており、顧問先が返しやすいことを最優先にしています。名義はあくまで「〇〇会計事務所の秘書」——事務所の顔を汚さないことが、この秘書の第一の職務規程です。</p>', d['F1A'], 1))
    R.append(('<summary>うちの顧問先はLINEではなくChatworkや電話なのだが。</summary>', d['F2S'], 1))
    R.append(('<p class="a">秘書は相手のいる場所へ出向きます。LINE・メール・Chatwork・Slack・Google Chatに対応し、顧問先ごとに使い分けられます。どうしても電話でしか動かない相手は、秘書が「電話が必要な相手リスト」として週次報告に整理して上げるので、人の電話を最小の件数に絞れます。</p>', d['F2A'], 1))
    R.append(('<p class="a">導入は「入社手続き」だけです。顧問先のリストと、毎月・決算期に集めるものを秘書に教える——初回15〜30分で終わります。事務所側が新しい画面の操作を覚える必要は基本的にありません。秘書が動き、報告が届く。それだけです。</p>', d['F3A'], 1))
    R.append(('<summary>顧問先の資料を預けて、セキュリティは大丈夫か。</summary>', d['F4S'], 1))
    R.append(('<p class="a">受領した資料とやり取りの記録は、事務所ごとに分離された領域に暗号化して保管し、事務所のメンバー以外はアクセスできません。やり取りの全履歴が証跡として残ること自体が、「渡した・もらってない」トラブルからの防御にもなります。詳細な安全管理措置は、先行導入のご相談時に資料でご説明します。</p>', d['F4A'], 1))

    # --- final ---
    fh = re.fullmatch(r'<h2 class="mincho">(.+)</h2>', d['FINH2'].strip(), re.S)
    R.append(('<h2>最初の5事務所を、<br>募集します。</h2>', f'<h2>{fh.group(1)}</h2>', 1))
    finpara = strip_tags(d['FINPARA'])
    R.append(('<p class="final-lead">このサービスはいま、実際の会計事務所と一緒に作る段階にあります。先行導入の事務所には、貴所の顧問先・チャネル・回収物に合わせて秘書を作り込み、月給も一緒に決めさせていただきます。</p>',
              f'<p class="final-lead">{finpara}</p>', 1))
    R.append(('<span class="perk">貴所の運用に合わせた作り込み</span>', d['PERK1'], 1))
    R.append(('''<div class="lf-row">
          <label class="lf-label" for="lf-company">事務所名 <span class="lf-opt">任意</span></label>
          <input class="lf-input" id="lf-company" name="company" type="text" placeholder="〇〇会計事務所" autocomplete="organization">
        </div>''', d['FORMCOMPANY'], 1))
    R.append(('<span>skara ｜ 税理士・会計事務所のためのAI秘書（先行導入募集中・開発中のサービスです）</span>', d['FOOTER'], 1))

    return R


def main():
    src = open(SRC, encoding='utf-8').read()
    for lp, d in INDUSTRIES.items():
        html = src.replace('/lp1/images/', '/lp-assets/')
        for old, new, n in build_replacements(lp, d):
            cnt = html.count(old)
            assert cnt == n, f'{lp}: 出現{cnt}回(期待{n}): {old[:60]}...'
            html = html.replace(old, new)
        for word in d['FORBIDDEN']:
            assert word not in html, f'{lp}: leftover "{word}"'
        outdir = os.path.join(ROOT, 'public', lp)
        os.makedirs(outdir, exist_ok=True)
        with open(os.path.join(outdir, 'index.html'), 'w', encoding='utf-8') as f:
            f.write(html)
        print(f'{lp}: written ({len(html)//1024} KB)')
    print('all editorial LPs generated OK')


if __name__ == '__main__':
    main()
