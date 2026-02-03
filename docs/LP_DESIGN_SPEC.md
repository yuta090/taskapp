# Service LP Design Specification

## 1. Design Concept
**Theme:** "Premium Minimalist for Developers"
**Keywords:** Clarity, Velocity, Focus, Professional
**Visual Style:**
- **Soco St. Inspired:** Flat vector illustrations, no gradients, clean lines.
- **Glassmorphism:** Subtle use of blur in sticky headers and floating cards to add modern depth.
- **Whitespace:** Generous padding to create a sense of calm and focus.

## 2. Color Palette (Tailwind CSS)

| Role | Color | Tailwind Class | Hex | Usage |
|:---|:---|:---|:---|:---|
| **Primary** | **Amber** | `bg-amber-500` | `#F59E0B` | Primary Buttons (CTA), Highlights, Brand Elements |
| **Secondary** | **Slate Blue** | `text-slate-900` | `#0F172A` | Headings, Strong Text |
| **Body** | **Slate Grey** | `text-slate-600` | `#475569` | Body Text, Subtitles |
| **Background** | **White / Off-White** | `bg-white` / `bg-slate-50` | `#F8FAFC` | Page Background, Section Alternation |
| **Accent** | **Indigo** | `text-indigo-600` | `#4F46E5` | Links, Technical Accents (API, Code) |
| **Success** | **Emerald** | `text-emerald-500` | `#10B981` | "Success", "Done", Checkmarks |

## 3. Typography
**Font Family:** `Inter`, sans-serif (Google Fonts)
- **H1 (Hero):** Bold / ExtraBold, 3.75rem (60px), Tight tracking (`-0.02em`)
- **H2 (Section):** Bold, 2.25rem (36px)
- **H3 (Card Title):** SemiBold, 1.25rem (20px)
- **Body:** Regular, 1rem (16px), Relaxed line-height (`1.6`)

## 4. Section Layout Strategy

### ① Hero Section
- **Layout:** Split Screen (Left: Text / Right: Image)
- **Image:** `hero_dev_ai.png` (Large, extending to edge)
- **Interaction:** Fade-in up for text, slight float animation for image.
- **Background:** White w/ subtle dot pattern.

### ② The Problem (課題提起)
- **Layout:** Center Aligned Text -> 3 Column Cards
- **Image:** `pain_multitasking.png` (Used as a central visual anchor before cards)
- **Cards:** "Switching Cost", "Estimate Hell", "Lost in Chat".
- **Background:** `bg-slate-50` (Light grey contrast)

### ③ The Solution (Concept)
- **Layout:** Center Focus (Isometric View)
- **Image:** `concept_architecture_iso.png` (Full width container)
- **Text:** Overlaid or surrounding the architecture to explain "AI <-> Dev <-> Client".

### ④ 4 Key Features (Dynamic & Interactive)
単純なジグザグではなく、機能の特性に合わせた最適な「見せ方」を変化させる。

1.  **AI Operation (The "Live" Terminal)**
    *   **Layout:** Split (Text Left / Code Right)
    *   **Gimmick:** **Typing Animation**. 右側のターミナルウィンドウ内で、コマンドが自動で打ち込まれ、AIが応答する様子をCSSアニメーションで再現。「画像」ではなく「動くコード」として実装し、エンジニアの目を釘付けにする。
    *   **Visual:** Dark mode terminal window with syntax highlighting.

2.  **Ball Ownership (The "Hot Potato" Visual)**
    *   **Layout:** Center Focus / Bento Grid
    *   **Gimmick:** インタラクティブなカード配置。
    *   **Visual:** 大小のカード（Bento Grid）で構成。「ボールを持っている人」のカードだけがわずかに浮き上がり（Pulse effect）、Amber色の光（Glow）を放つ演出。責任の所在が一目でわかる直感的なデザイン。

3.  **Client Portal (The "Calm" View)**
    *   **Layout:** Full Width (Glassmorphism Overlay)
    *   **Gimmick:** 背景にぼかした「混沌とした開発ログ」を敷き、その上に「整然としたポータル画面」をガラス風のカードで重ねる。
    *   **Meaning:** 「裏側のカオス」と「表側の平穏」の対比を視覚的に表現。

4.  **Workflow (The "Pipeline" Flow)**
    *   **Layout:** Horizontal Scroll / Step Process
    *   **Visual:** 左から右へ流れるパイプラインのアニメーション（SVG）。タスクが工程を通過するたびに色が変わり、完了になる様子を表現。

### ⑤ User Story (Day in the Life)
- **Layout:** Vertical Timeline with Scroll Spy
- **Gimmick:** スクロールに合わせて、現在時刻のアイコン（朝・昼・夕）がアクティブになり、背景色が微妙に変化（朝の爽やかな青→夕方の落ち着いた茜色）する没入型演出。


### ⑥ Closing / CTA
- **Layout:** Center Box (High distinct background, e.g., Dark Slate `bg-slate-900`)
- **Text:** White text.
- **Image:** `benefit_coding.png` (Subtle background blend or small float).
- **Button:** Large Amber-500 Button with glow effect.

## 5. Micro-Interactions
- **Buttons:** Hover scale (`scale-105`), Shadow increment (`shadow-lg`).
- **Scroll Reveal:** Elements fade in and slide up (`y-4` -> `y-0`, `opacity-0` -> `opacity-100`) as user scrolls.
- **Hover Cards:** Slight lift (`-translate-y-1`) on feature cards.
