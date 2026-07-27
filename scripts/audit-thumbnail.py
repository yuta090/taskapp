#!/usr/bin/env python3
"""サムネイルがスタイル指定を守れているかを数値で検収する。

目視だと「なんとなく良い」で通してしまい、実際には
「amberはアクセント」「フラット」「余白を広く」という指定が守られていない画像を
採用してしまった（2026-07-28 の指摘）。以後はこのスクリプトを通してから採用する。

判定するのは、目で見て曖昧になるものだけ:
  - 背景（クリーム）の面積比 … 余白が確保されているか
  - amber の面積比 … アクセントに留まっているか（大面積の机などになっていないか）
  - teal の面積比
  - 使われている色数 … フラットかどうかの代理指標（陰影やグラデがあると急増する）

使い方: python3 scripts/audit-thumbnail.py <画像パス>
終了コード 0 = 合格 / 1 = 不合格
"""
import sys
from collections import Counter

from PIL import Image

# ブランド色（記事サムネイルの指定）
PALETTE = {
    'cream': (0xF4, 0xED, 0xDE),
    'amber': (0xF5, 0x9E, 0x0B),
    'teal': (0x1F, 0xA7, 0x9A),
    'ink': (0x22, 0x1D, 0x18),
    'white': (0xFF, 0xFF, 0xFF),
}

# 合格条件
LIMITS = {
    'cream_min': 55.0,   # 背景（余白）は55%以上
    'amber_max': 12.0,   # amberはアクセント。12%を超えたら大面積に使われている
    'teal_max': 8.0,
    'unique_colors_max': 3000,  # フラットの代理指標。陰影・グラデが入ると跳ね上がる
}


def nearest(px, palette):
    r, g, b = px[:3]
    best, best_d = None, None
    for name, (pr, pg, pb) in palette.items():
        d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
        if best_d is None or d < best_d:
            best, best_d = name, d
    # どの基準色からも遠い色は「その他」（＝指定外の色）
    return best if best_d <= 90 ** 2 else 'other'


def audit(path):
    img = Image.open(path).convert('RGB')
    small = img.resize((300, 158))  # 集計用に縮小（比率は保つ）
    pixels = list(small.getdata())
    total = len(pixels)

    counts = Counter(nearest(p, PALETTE) for p in pixels)
    share = {k: counts.get(k, 0) / total * 100 for k in list(PALETTE) + ['other']}
    unique_colors = len(set(img.convert('RGB').getdata()))

    print(f'--- {path}')
    for k in ['cream', 'white', 'amber', 'teal', 'ink', 'other']:
        print(f'  {k:6s}: {share[k]:5.1f}%')
    print(f'  色数  : {unique_colors}')

    bg = share['cream'] + share['white']
    ng = []
    if bg < LIMITS['cream_min']:
        ng.append(f"背景が {bg:.1f}%（{LIMITS['cream_min']}%以上必要）＝余白が足りない")
    if share['amber'] > LIMITS['amber_max']:
        ng.append(f"amberが {share['amber']:.1f}%（上限{LIMITS['amber_max']}%）＝アクセントでなく大面積に使われている")
    if share['teal'] > LIMITS['teal_max']:
        ng.append(f"tealが {share['teal']:.1f}%（上限{LIMITS['teal_max']}%）")
    if unique_colors > LIMITS['unique_colors_max']:
        ng.append(f"色数が {unique_colors}（上限{LIMITS['unique_colors_max']}）＝陰影やグラデが入っている（フラットでない）")

    if ng:
        print('  判定: 不合格')
        for n in ng:
            print(f'    - {n}')
        return False
    print('  判定: 合格')
    return True


if __name__ == '__main__':
    ok = all(audit(p) for p in sys.argv[1:])
    sys.exit(0 if ok else 1)
