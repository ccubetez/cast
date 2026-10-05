/**
 * Ocean — радарный дисплей CAST-84 (Phase 1, retro-terminal skin).
 *
 * Chrome: range rings, crosshair, bearing ticks, coordinate readout.
 * Sweep: вращающийся луч с затухающим коническим следом; blips
 *        вспыхивают при проходе луча и гаснут с phosphor persistence.
 * Bubbles: векторные контуры (штрих), заливка ∝ flash + liquidity.
 * Жизнь: flow field, depth parallax, lerp, splash-кольца, trails,
 *        whale rings, магнитный курсор, планктон.
 */

'use client';

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useCastStore } from '@/lib/store';
import { mockEvaluate, tierFromScore, toPoolTokens } from '@/services/risk/mock-eligibility';
import { filterPool } from '@/services/risk/pools';
import type { MockToken } from '@/services/mock/mock-tokens';
import type { RiskTier } from '@/types';
import { createRng } from '@/lib/prng';
import { fmtPct, fmtUsd, shortMint } from '@/lib/format';
import { Badge } from '@/components/ui';

const WORLD = 4000;
const SWEEP_PERIOD = 6.5; // секунд на оборот луча
const TRAIL_RAD = 1.5; // длина следа за лучом, рад

/** Сектора рынка (Phase 12): зоны мира + правила отнесения токена. */
interface Sector {
  key: string;
  label: string;
  cx: number; // доля WORLD
  cy: number;
  radius: number; // доля WORLD
}

const SECTORS: readonly Sector[] = [
  { key: 'GRADUATED', label: 'GRADUATED', cx: 0.27, cy: 0.28, radius: 0.2 },
  { key: 'BONDING', label: 'BONDING CURVE', cx: 0.73, cy: 0.28, radius: 0.2 },
  { key: 'XSTOCK', label: 'xSTOCK', cx: 0.27, cy: 0.72, radius: 0.2 },
  { key: 'DEEP', label: 'DEEP WATERS', cx: 0.73, cy: 0.72, radius: 0.2 },
];

function sectorOf(token: MockToken): Sector {
  const cat = token.category?.toLowerCase();
  // токенизированные активы (xStock-семейство) — свой сектор
  if (cat === 'xstock' || cat === 'prestock' || cat === 'leverage' || cat === 'tessera') return SECTORS[2] as Sector;
  if (token.status === 'GRADUATED') return SECTORS[0] as Sector;
  if (token.status === 'ACTIVE' || token.status === 'GRADUATING') return SECTORS[1] as Sector;
  return SECTORS[3] as Sector;
}

export interface NodeScreenPos {
  sx: number;
  sy: number;
  r: number;
  symbol: string;
}

interface OceanNode {
  x: number;
  y: number;
  layer: number;
  speedBase: number;
  phase: number;
  tier: RiskTier;
  sector: Sector;
  r: number;
  alpha: number;
  glow: number;
  colR: number;
  colG: number;
  colB: number;
  flash: number; // 0..1, послесвечение после луча
  lastPrice: number;
  trail: { x: number; y: number }[];
}

interface Ring {
  x: number;
  y: number;
  r: number;
  alpha: number;
  red: boolean;
}

interface Hover {
  token: MockToken;
  sx: number;
  sy: number;
}

function normLog(v: number, min: number, max: number): number {
  const l = Math.log(Math.max(v, 1));
  const lmin = Math.log(Math.max(min, 1));
  const lmax = Math.log(Math.max(max, 1));
  return lmax > lmin ? (l - lmin) / (lmax - lmin) : 0.5;
}

function flowAngle(x: number, y: number, t: number): number {
  return (
    Math.sin(x * 0.0009 + t * 0.07) * 1.6 +
    Math.cos(y * 0.0007 - t * 0.05) * 1.6 +
    Math.sin((x + y) * 0.0004 + t * 0.03)
  );
}

const BONE = { r: 232, g: 230, b: 225 }; // прибыль / primary
const ASH = { r: 110, g: 110, b: 116 }; // убыток
const PHOS = '232,230,225';

function normAngle(a: number): number {
  const m = a % (Math.PI * 2);
  return m < 0 ? m + Math.PI * 2 : m;
}

export function OceanCanvas({
  mode,
  onSelect,
  nodesScreenRef,
  sectors = true,
}: {
  mode?: import('@/types').DiscoverMode;
  onSelect?: (token: MockToken) => void;
  nodesScreenRef?: MutableRefObject<Map<string, NodeScreenPos> | null>;
  sectors?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Map<string, OceanNode>>(new Map());
  const ringsRef = useRef<Ring[]>([]);
  const planktonRef = useRef<{ x: number; y: number; layer: number; size: number; phase: number }[] | null>(null);
  const camRef = useRef({ x: WORLD / 2, y: WORLD / 2, zoom: 0.55 });
  const prevBeamRef = useRef(0);
  const dragRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const hoverRef = useRef<string | null>(null);
  const filterMintsRef = useRef<Set<string> | null>(null);
  const sectorsRef = useRef(sectors);
  useEffect(() => {
    sectorsRef.current = sectors;
  }, [sectors]);

  const tokens = useCastStore((s) => s.tokens);
  const risk = useCastStore((s) => s.risk);
  useEffect(() => {
    filterMintsRef.current = mode
      ? new Set(filterPool(toPoolTokens(tokens, risk), mode).map((p) => p.token.mint))
      : null;
  }, [mode, tokens, risk]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    const t0 = last;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.clientWidth * devicePixelRatio;
      canvas.height = parent.clientHeight * devicePixelRatio;
      canvas.style.width = `${parent.clientWidth}px`;
      canvas.style.height = `${parent.clientHeight}px`;
    };
    resize();
    window.addEventListener('resize', resize);

    if (!planktonRef.current) {
      const rng = createRng('ocean-plankton');
      planktonRef.current = Array.from({ length: 180 }, () => ({
        x: rng() * WORLD,
        y: rng() * WORLD,
        layer: rng(),
        size: 0.6 + rng() * 1.4,
        phase: rng() * Math.PI * 2,
      }));
    }

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;

      const tokensNow = useCastStore.getState().tokens;
      const nodes = nodesRef.current;
      const rings = ringsRef.current;
      const cam = camRef.current;
      const filter = filterMintsRef.current;

      const dpr = devicePixelRatio;
      const cssW = canvas.width / dpr;
      const cssH = canvas.height / dpr;
      const cx = cssW / 2;
      const cy = cssH / 2;
      const toScreen = (wx: number, wy: number, k: number) => ({
        sx: (wx - cam.x * k) * cam.zoom + cx,
        sy: (wy - cam.y * k) * cam.zoom + cy,
      });

      // ── синхронизация нод ──
      const visible: MockToken[] = [];
      let mcapMin = Infinity;
      let mcapMax = 0;
      let volMax = 0;
      for (const tk of tokensNow) {
        if (filter && !filter.has(tk.mint)) continue;
        visible.push(tk);
        mcapMin = Math.min(mcapMin, tk.marketCapUsd ?? 1);
        mcapMax = Math.max(mcapMax, tk.marketCapUsd ?? 1);
        volMax = Math.max(volMax, tk.volume24hUsd ?? 0);
        if (!nodes.has(tk.mint)) {
          const rng = createRng(`ocean-${tk.mint}`);
          const serverRisk = useCastStore.getState().risk[tk.mint];
          const verdict = serverRisk ?? mockEvaluate(tk);
          const sector = sectorOf(tk);
          nodes.set(tk.mint, {
            // спавн внутри зоны своего сектора (Phase 12)
            x: (sector.cx + (rng() - 0.5) * sector.radius * 1.6) * WORLD,
            y: (sector.cy + (rng() - 0.5) * sector.radius * 1.6) * WORLD,
            layer: rng(),
            speedBase: 2 + rng() * 5,
            phase: rng() * Math.PI * 2,
            tier: serverRisk?.riskTier ?? tierFromScore(verdict.riskScore),
            sector,
            r: 6,
            alpha: 0.4,
            glow: 0,
            colR: BONE.r,
            colG: BONE.g,
            colB: BONE.b,
            flash: 0,
            lastPrice: tk.priceUsd ?? 0,
            trail: [],
          });
        }
      }

      const byVol = [...visible].sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0)).slice(0, 5);
      const trailSet = new Set(byVol.map((x) => x.mint));
      const whaleSet = new Set(
        [...visible].sort((a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0)).slice(0, 3).map((x) => x.mint),
      );

      // ── рендер ──
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // ── radar chrome: range rings + crosshair + bearing ticks ──
      const rMax = Math.min(cssW, cssH) * 0.48;
      ctx.lineWidth = 1;
      for (const f of [0.25, 0.5, 0.75, 1]) {
        ctx.beginPath();
        ctx.arc(cx, cy, rMax * f, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${PHOS},${f === 1 ? 0.12 : 0.06})`;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(0, cy); ctx.lineTo(cssW, cy);
      ctx.moveTo(cx, 0); ctx.lineTo(cx, cssH);
      ctx.strokeStyle = `rgba(${PHOS},0.05)`;
      ctx.stroke();
      // центральная метка
      ctx.beginPath();
      ctx.moveTo(cx - 5, cy); ctx.lineTo(cx + 5, cy);
      ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 5);
      ctx.strokeStyle = `rgba(${PHOS},0.5)`;
      ctx.stroke();
      // bearing ticks
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let deg = 0; deg < 360; deg += 45) {
        const a = ((deg - 90) * Math.PI) / 180;
        const lx = cx + Math.cos(a) * (rMax + 14);
        const ly = cy + Math.sin(a) * (rMax + 14);
        if (lx < 20 || lx > cssW - 20 || ly < 16 || ly > cssH - 10) continue;
        ctx.fillStyle = `rgba(${PHOS},0.3)`;
        ctx.fillText(String(deg).padStart(3, '0'), lx, ly);
      }

      // ── сектора: подписи зон + пунктирные границы (Phase 12) ──
      if (sectorsRef.current) {
        for (const s of SECTORS) {
          const sp = toScreen(s.cx * WORLD, s.cy * WORLD, 1);
          const zoneR = s.radius * WORLD * cam.zoom;
          ctx.beginPath();
          ctx.arc(sp.sx, sp.sy, zoneR, 0, Math.PI * 2);
          ctx.setLineDash([4, 6]);
          ctx.strokeStyle = `rgba(${PHOS},0.05)`;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = '11px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = `rgba(${PHOS},0.3)`;
          ctx.fillText(`· ${s.label} ·`, sp.sx, sp.sy - zoneR - 8);
        }
      }

      // ── вращающийся луч + конический след ──
      const beamAngle = normAngle((t / SWEEP_PERIOD) * Math.PI * 2 - Math.PI / 2);
      const prevBeam = prevBeamRef.current;
      const R = Math.hypot(cssW, cssH) / 2 + 40;
      if (typeof ctx.createConicGradient === 'function') {
        const g = ctx.createConicGradient(beamAngle - TRAIL_RAD, cx, cy);
        const trailStop = TRAIL_RAD / (Math.PI * 2);
        g.addColorStop(0, `rgba(${PHOS},0)`);
        g.addColorStop(Math.max(0, trailStop - 0.002), `rgba(${PHOS},0.13)`);
        g.addColorStop(Math.min(1, trailStop + 0.002), `rgba(${PHOS},0)`);
        g.addColorStop(1, `rgba(${PHOS},0)`);
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
      }
      ctx.save();
      ctx.shadowColor = `rgba(${PHOS},0.8)`;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(beamAngle) * R, cy + Math.sin(beamAngle) * R);
      ctx.strokeStyle = `rgba(${PHOS},0.75)`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();

      // планктон
      for (const p of planktonRef.current ?? []) {
        const k = 0.35 + 0.3 * p.layer;
        const { sx, sy } = toScreen(p.x, p.y, k);
        if (sx < -10 || sx > cssW + 10 || sy < -10 || sy > cssH + 10) continue;
        const tw = 0.5 + 0.5 * Math.sin(t * 0.6 + p.phase);
        ctx.beginPath();
        ctx.arc(sx, sy, p.size * cam.zoom, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(120,190,150,${(0.04 + 0.06 * tw).toFixed(3)})`;
        ctx.fill();
      }

      const mouse = mouseRef.current;
      let hoveredMint: string | null = null;
      let hoveredToken: MockToken | null = null;
      let hoveredScreen = { sx: 0, sy: 0 };
      const screenMap = nodesScreenRef ? (nodesScreenRef.current ?? new Map<string, NodeScreenPos>()) : null;

      for (const token of visible) {
        const node = nodes.get(token.mint);
        if (!node) continue;

        const k = 0.55 + 0.45 * node.layer;

        // flow field
        const volSpeed = 1 + 3 * normLog(token.volume24hUsd ?? 0, 1, Math.max(volMax, 1));
        const ang = flowAngle(node.x, node.y, t);
        node.x += Math.cos(ang) * node.speedBase * volSpeed * k * dt * 2.2;
        node.y += Math.sin(ang) * node.speedBase * volSpeed * k * dt * 2.2;
        // слабая пружина к центру сектора — кластер держится, но «дышит»
        if (sectorsRef.current) {
          node.x += (node.sector.cx * WORLD - node.x) * 0.012 * dt * k;
          node.y += (node.sector.cy * WORLD - node.y) * 0.012 * dt * k;
        }
        if (node.x < 0) node.x += WORLD;
        if (node.x > WORLD) node.x -= WORLD;
        if (node.y < 0) node.y += WORLD;
        if (node.y > WORLD) node.y -= WORLD;

        // цели + lerp
        const rTarget =
          (3 + 17 * normLog(token.marketCapUsd ?? 1, mcapMin, mcapMax)) * (0.7 + 0.3 * node.layer);
        const chg = token.priceChange24hPct ?? 0;
        const colTarget = chg >= 0 ? BONE : ASH;
        const glowTarget = Math.min(1, Math.abs((token.priceChange1hPct ?? 0) / 100) * 8);
        const liqConf = Math.min(1, (token.liquidityUsd ?? 0) / 500_000);
        const alphaTarget = (0.22 + 0.68 * liqConf) * (0.45 + 0.55 * node.layer);

        const L = Math.min(1, dt * 2.6);
        node.r += (rTarget - node.r) * L;
        node.glow += (glowTarget - node.glow) * L;
        node.alpha += (alphaTarget - node.alpha) * L;
        node.colR += (colTarget.r - node.colR) * L;
        node.colG += (colTarget.g - node.colG) * L;
        node.colB += (colTarget.b - node.colB) * L;

        // splash
        const price = token.priceUsd ?? 0;
        if (node.lastPrice > 0 && price > 0) {
          const rel = (price - node.lastPrice) / node.lastPrice;
          if (Math.abs(rel) > 0.008 && rings.length < 24) {
            rings.push({ x: node.x, y: node.y, r: node.r * cam.zoom, alpha: 0.5, red: rel < 0 });
          }
        }
        node.lastPrice = price;

        // sweep flash: луч прошёл угол токена?
        const tokenAngle = normAngle(Math.atan2(node.y - cam.y, node.x - cam.x));
        const crossed =
          prevBeam <= beamAngle
            ? tokenAngle > prevBeam && tokenAngle <= beamAngle
            : tokenAngle > prevBeam || tokenAngle <= beamAngle;
        if (crossed) node.flash = 1;
        node.flash *= Math.exp(-dt / 1.9); // phosphor persistence

        // позиция + магнитный курсор
        let { sx, sy } = toScreen(node.x, node.y, k);
        let alphaBoost = 0;
        if (mouse) {
          const dx = sx - mouse.x;
          const dy = sy - mouse.y;
          const d = Math.hypot(dx, dy);
          if (d < 140 && d > 0.01) {
            const push = (1 - d / 140) * 22;
            sx += (dx / d) * push;
            sy += (dy / d) * push;
            alphaBoost = (1 - d / 140) * 0.3;
          }
        }

        const isRisky = node.tier === 'HIGH' || node.tier === 'EXTREME';
        const pulse = isRisky ? 1 + 0.16 * Math.sin(t * 2.2 + node.phase) : 1;
        const rScreen = node.r * pulse * cam.zoom;
        const alpha = Math.min(1, node.alpha * (0.55 + 0.45 * node.flash) + node.flash * 0.35 + alphaBoost);
        const col = `${Math.round(node.colR)},${Math.round(node.colG)},${Math.round(node.colB)}`;

        // trail
        if (trailSet.has(token.mint)) {
          const lastP = node.trail[node.trail.length - 1];
          if (!lastP || Math.hypot(node.x - lastP.x, node.y - lastP.y) > 1.5) {
            node.trail.push({ x: node.x, y: node.y });
            if (node.trail.length > 16) node.trail.shift();
          }
          if (node.trail.length > 2) {
            ctx.beginPath();
            node.trail.forEach((p, i) => {
              const sp = toScreen(p.x, p.y, k);
              if (i === 0) ctx.moveTo(sp.sx, sp.sy);
              else ctx.lineTo(sp.sx, sp.sy);
            });
            ctx.strokeStyle = `rgba(${col},0.10)`;
            ctx.lineWidth = Math.max(1, rScreen * 0.25);
            ctx.stroke();
          }
        } else if (node.trail.length > 0) {
          node.trail = [];
        }

        // whale rings
        if (whaleSet.has(token.mint)) {
          for (let i = 0; i < 2; i++) {
            const wr = rScreen * (1.7 + 0.45 * Math.sin(t * 0.7 + i * 2.1 + node.phase));
            ctx.beginPath();
            ctx.arc(sx, sy, Math.max(wr, rScreen + 3), 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${col},${(0.05 + 0.03 * i).toFixed(3)})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }

        // halo: риск — фиолетовый, иначе — по цвету при flash
        if (isRisky || node.flash > 0.1 || node.glow > 0.05) {
          ctx.beginPath();
          ctx.arc(sx, sy, rScreen * (1.9 + node.glow), 0, Math.PI * 2);
          const haloColor = isRisky ? '139,139,144' : col;
          ctx.fillStyle = `rgba(${haloColor},${Math.min(0.2, 0.04 + 0.09 * (node.glow + node.flash)).toFixed(3)})`;
          ctx.fill();
        }

        // vector soul: контур + слабая заливка (∝ flash); рискованные — штрихованные
        ctx.beginPath();
        ctx.arc(sx, sy, rScreen, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${col},${(alpha * 0.16 + node.flash * 0.28).toFixed(3)})`;
        ctx.fill();
        if (isRisky) ctx.setLineDash([3, 3]);
        ctx.strokeStyle = `rgba(${col},${alpha.toFixed(3)})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.setLineDash([]);

        // белое ядро при ярком послесвечении
        if (node.flash > 0.55) {
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(1.2, rScreen * 0.22), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${((node.flash - 0.5) * 1.4).toFixed(3)})`;
          ctx.fill();
        }

        if (screenMap) screenMap.set(token.mint, { sx, sy, r: rScreen, symbol: token.symbol });

        // hover: bracket-рамка
        if (mouse) {
          const dx = mouse.x - sx;
          const dy = mouse.y - sy;
          if (dx * dx + dy * dy < (rScreen + 6) ** 2) {
            hoveredMint = token.mint;
            hoveredToken = token;
            hoveredScreen = { sx, sy };
            const b = rScreen + 6;
            const l = 6;
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(232,230,225,0.9)';
            ctx.lineWidth = 1.4;
            ctx.moveTo(sx - b, sy - b + l); ctx.lineTo(sx - b, sy - b); ctx.lineTo(sx - b + l, sy - b);
            ctx.moveTo(sx + b - l, sy - b); ctx.lineTo(sx + b, sy - b); ctx.lineTo(sx + b, sy - b + l);
            ctx.moveTo(sx + b, sy + b - l); ctx.lineTo(sx + b, sy + b); ctx.lineTo(sx + b - l, sy + b);
            ctx.moveTo(sx - b + l, sy + b); ctx.lineTo(sx - b, sy + b); ctx.lineTo(sx - b, sy + b - l);
            ctx.stroke();
          }
        }
      }
      prevBeamRef.current = beamAngle;

      // splash rings
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i] as Ring;
        ring.r += 90 * dt;
        ring.alpha -= dt * 1.1;
        if (ring.alpha <= 0) {
          rings.splice(i, 1);
          continue;
        }
        const { sx, sy } = toScreen(ring.x, ring.y, 1);
        ctx.beginPath();
        ctx.arc(sx, sy, ring.r, 0, Math.PI * 2);
        ctx.strokeStyle = ring.red
          ? `rgba(110,110,116,${ring.alpha.toFixed(3)})`
          : `rgba(${PHOS},${ring.alpha.toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // coordinate readout
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(201,201,206,0.5)';
      if (mouse) {
        const mwx = cam.x + (mouse.x - cx) / cam.zoom;
        const mwy = cam.y + (mouse.y - cy) / cam.zoom;
        ctx.fillText(`GRD ${mwx.toFixed(1)} / ${mwy.toFixed(1)}`, cssW - 14, cssH - 26);
      }
      ctx.fillText(`Z ${cam.zoom.toFixed(2)} · SWP ${(SWEEP_PERIOD - (t % SWEEP_PERIOD)).toFixed(1)}s`, cssW - 14, cssH - 12);

      if (nodesScreenRef) nodesScreenRef.current = screenMap;

      if (hoveredMint !== hoverRef.current) {
        hoverRef.current = hoveredMint;
        setHover(hoveredToken ? { token: hoveredToken, ...hoveredScreen } : null);
      } else if (hoveredToken) {
        setHover({ token: hoveredToken, ...hoveredScreen });
      }

      canvas.style.cursor = hoveredMint ? 'pointer' : dragRef.current ? 'grabbing' : 'crosshair';
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toLocal = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: 0, y: 0 };
  };

  return (
    <div className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        onMouseDown={(e) => {
          const p = toLocal(e);
          dragRef.current = { sx: p.x, sy: p.y, cx: camRef.current.x, cy: camRef.current.y };
        }}
        onMouseUp={(e) => {
          const drag = dragRef.current;
          dragRef.current = null;
          if (drag && hover && Math.abs(toLocal(e).x - drag.sx) < 4 && Math.abs(toLocal(e).y - drag.sy) < 4) {
            onSelect?.(hover.token);
          }
        }}
        onMouseLeave={() => {
          dragRef.current = null;
          mouseRef.current = null;
        }}
        onMouseMove={(e) => {
          const p = toLocal(e);
          mouseRef.current = p;
          const drag = dragRef.current;
          if (drag) {
            camRef.current.x = drag.cx - (p.x - drag.sx) / camRef.current.zoom;
            camRef.current.y = drag.cy - (p.y - drag.sy) / camRef.current.zoom;
          }
        }}
        onWheel={(e) => {
          const cam = camRef.current;
          const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
          cam.zoom = Math.min(3, Math.max(0.15, cam.zoom * factor));
        }}
      />

      {hover && (
        <div
          className="pointer-events-none absolute z-10 etched bg-panel/95 px-3 py-2 shadow-xl backdrop-blur"
          style={{ left: Math.min(hover.sx + 14, (canvasRef.current?.clientWidth ?? 400) - 190), top: hover.sy + 14 }}
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-white">{hover.token.symbol}</span>
            <span
              className="font-mono text-xs"
              style={{ color: (hover.token.priceChange24hPct ?? 0) >= 0 ? '#E8E6E1' : '#9A9AA0' }}
            >
              {fmtPct(hover.token.priceChange24hPct)}
            </span>
          </div>
          <div className="mt-1 space-y-0.5 font-mono text-[10px] text-muted">
            <div>mcap {fmtUsd(hover.token.marketCapUsd)} · liq {fmtUsd(hover.token.liquidityUsd)}</div>
            <div>vol24h {fmtUsd(hover.token.volume24hUsd)}</div>
            <div>{shortMint(hover.token.mint)}</div>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted">
        <Badge tone="cyan">sonar</Badge>
        <FeedSourceBadge />
        <span>{tokens.length} obj tracked</span>
        <span className="hidden sm:inline">· drag pan · scroll zoom</span>
      </div>
    </div>
  );
}

function FeedSourceBadge() {
  const source = useCastStore((s) => s.feedSource);
  return source === 'stonkfun' ? (
    <Badge tone="green">live · stonkfun</Badge>
  ) : (
    <Badge tone="amber">mock feed</Badge>
  );
}
