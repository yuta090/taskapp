"use client";
/** SVG直書きチャート3種（外部ライブラリ不要）。デザインは design.md 準拠 */
import { useEffect, useState } from "react";
import { PROCESS_KEYS, typesFor, Role, VERB_KEYS, VERBS, VerbKey } from "@/lib/shindan/model";

const VB_W = 340, VB_H = 290;

function polar(cx: number, cy: number, r: number, idx: number, n: number): [number, number] {
  const ang = (Math.PI * 2 * idx) / n - Math.PI / 2;
  return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
}

/** 数値カウントアップ（reduced-motion時は即時表示） */
function useCountUp(target: number, ms = 900, delay = 450) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // 即時表示(lint: effect内の同期setStateを避けるためrAF経由)
      const raf = requestAnimationFrame(() => setV(target));
      return () => cancelAnimationFrame(raf);
    }
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - t0) / ms));
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, delay]);
  return v;
}

/* ===== 軸ラベルのツールチップ ===== */
interface Tip { x: number; y: number; title: string; body: string }

function ChartTip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  const tx = tip.x < 100 ? "0%" : tip.x > VB_W - 100 ? "-100%" : "-50%";
  return (
    <div className="chart-tip" style={{ left: `${(tip.x / VB_W) * 100}%`, top: `${(tip.y / VB_H) * 100}%`, transform: `translate(${tx}, -120%)` }}>
      <b>{tip.title}</b>{tip.body}
    </div>
  );
}

function Web({ cx, cy, R, n }: { cx: number; cy: number; R: number; n: number }) {
  return (
    <>
      {[0.33, 0.66, 1].map((f) => (
        <polygon key={f} points={Array.from({ length: n }, (_, i) => polar(cx, cy, R * f, i, n).join(",")).join(" ")}
          fill="none" stroke="#e5e3e0" strokeWidth={1} />
      ))}
      {Array.from({ length: n }, (_, i) => {
        const [x, y] = polar(cx, cy, R, i, n);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e5e3e0" strokeWidth={1} />;
      })}
    </>
  );
}

/** 8タイプ滞留レーダー（高い=問題）— ラベル・解説は役割別（design.md/model.ts参照） */
export function TypeRadar({ type, role }: { type: Record<string, number>; role: Role }) {
  const cx = 170, cy = 145, R = 100, n = PROCESS_KEYS.length;
  const TYPES = typesFor(role);
  const [tip, setTip] = useState<Tip | null>(null);
  const poly = PROCESS_KEYS.map((k, i) => polar(cx, cy, (R * (type[k] || 0)) / 100, i, n).join(",")).join(" ");
  return (
    <div className="chartwrap" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" style={{ maxWidth: VB_W }} role="img" aria-label="滞留タイプ">
        <Web cx={cx} cy={cy} R={R} n={n} />
        <polygon points={poly} className="poly-anim" style={{ transformOrigin: `${cx}px ${cy}px` }}
          fill="rgba(224,30,90,.16)" stroke="#e01e5a" strokeWidth={2} />
        {PROCESS_KEYS.map((k, i) => {
          const [x, y] = polar(cx, cy, R + 22, i, n);
          const t = TYPES[k];
          const show = () => setTip({ x, y, title: `${t.name}（一致度 ${type[k] || 0}%）`, body: t.tip });
          return (
            <text key={k} x={x} y={y} fontSize={10.5} className="axis-label" textAnchor="middle" dominantBaseline="middle"
              onMouseEnter={show} onClick={show}>{t.short}</text>
          );
        })}
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

/** 完遂力ダイアグラム（6動詞・高い=強い） */
export function VerbHexagon({ verb }: { verb: Record<VerbKey, number> }) {
  const cx = 170, cy = 145, R = 100, n = VERB_KEYS.length;
  const [tip, setTip] = useState<Tip | null>(null);
  const poly = VERB_KEYS.map((k, i) => polar(cx, cy, (R * (verb[k] || 0)) / 100, i, n).join(",")).join(" ");
  return (
    <div className="chartwrap" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" style={{ maxWidth: VB_W }} role="img" aria-label="仕事を進める6つの力">
        <Web cx={cx} cy={cy} R={R} n={n} />
        <polygon points={poly} className="poly-anim" style={{ transformOrigin: `${cx}px ${cy}px` }}
          fill="rgba(217,119,6,.16)" stroke="#d97706" strokeWidth={2} />
        {VERB_KEYS.map((k, i) => {
          const [x, y] = polar(cx, cy, R + 24, i, n);
          const v = VERBS[k];
          const show = () => setTip({ x, y, title: `${v.plain}（${verb[k] || 0}%）`, body: v.desc });
          return (
            <text key={k} x={x} y={y} fontSize={12} fontWeight={700} className="axis-label axis-label--strong"
              textAnchor="middle" dominantBaseline="middle" onMouseEnter={show} onClick={show}>{v.plain}</text>
          );
        })}
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

/** 量の負荷ゲージ */
export function LoadGauge({ load }: { load: number }) {
  const color = load >= 66 ? "#e01e5a" : load >= 40 ? "#ffcc17" : "#d97706";
  const n = useCountUp(load);
  return (
    <div>
      <div className="gauge-label"><span>量の負荷</span><span>{n}%</span></div>
      <div className="gauge"><i style={{ width: `${load}%`, background: color }} /></div>
    </div>
  );
}
