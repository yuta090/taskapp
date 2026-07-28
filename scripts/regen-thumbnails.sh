#!/bin/bash
# TASK6 のサムネイルを、スタイル指定を守った形で生成する。
#
# ⚠ 生成後は必ず scripts/audit-thumbnail.py で**数値検収**する（目視だけで採用しない）。
#   画像生成モデルは被写体は言ったとおりに描くが、スタイル指定（フラット・余白・アクセント色）は
#   高確率で無視する。目で見ると「指示どおり」に見えてしまうため、色数と面積比で判定する。
# ⚠ agy の出力を捨てない（/dev/null に流すと、生成できていないことに気づけない）。
set -u
cd /Volumes/WIN-MAC2/scripts/taskapp-wt-t6art
OUT=public/task6/thumbnails

RULES='This is a STRICT style specification. Follow every constraint exactly.

HARD CONSTRAINTS (all must be true):
1. Background: solid flat cream #F4EDDE covering at least 65% of the canvas. No texture, no gradient, no vignette, no paper grain.
2. Style: FLAT vector. Absolutely NO shading, NO gradients, NO drop shadows, NO wood grain, NO hatching, NO sketchy or pencil strokes, NO highlights.
3. Line work: uniform-weight dark ink #221D18 outlines only.
4. Amber #F59E0B is an ACCENT ONLY: at most 10% of the canvas, on one or two small elements. NEVER use amber for a large surface such as a desk, wall, or floor.
5. Teal #1FA79A is a secondary accent, at most 5% of the canvas.
6. Do NOT draw furniture (no desk, no table, no chair, no room). Objects float on the plain cream background with generous empty space around them.
7. Use at most 5 distinct colors in total.
8. No text, letters, numbers, logos, app icons, or watermarks.

Draw only what the SUBJECT describes. Do not add extra props.'

gen () {
  local name="$1" subject="$2"
  echo "=== $name"
  # ⚠ agy はエイリアス（--dangerously-skip-permissions 付き）。スクリプト内では展開されないため明示する
  agy --dangerously-skip-permissions --print-timeout 300s -p "Generate a 1200x630 PNG and save it to /Volumes/WIN-MAC2/scripts/taskapp-wt-t6art/$OUT/$name.png

$RULES

SUBJECT: $subject" 2>&1 | tail -3
  find . -name "._*" -delete 2>/dev/null
  python3 scripts/audit-thumbnail.py "$OUT/$name.png" 2>/dev/null
}

gen "multitask-nigate-capacity" "a tall stack of loose paper sheets on the left, and to its right a small empty square outline drawn with a thin ink line. The stack is clearly taller than the square, so it cannot fit inside. Nothing else."

gen "task-jouzu-shimekiri" "a single sheet of paper in the center with a small amber square stamp mark in its corner, and one thin ink arrow that leaves the sheet to the right, curves around, and returns to the sheet. Nothing else."

gen "remine-kun-tsukaikata" "a small amber bell in the center, and three identical empty speech bubbles arranged around it, all outlined in ink and left blank. Nothing else."

gen "notion-task-memo-ka" "a rectangular table grid drawn with thin ink lines, four rows and three columns, floating in the center. Only the cells of the leftmost column contain two short ink scribble lines each. All other cells are completely empty. Nothing else."
