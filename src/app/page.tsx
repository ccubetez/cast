import Link from 'next/link';
import { Button } from '@/components/ui';

const FENCE = '^  '.repeat(46).trim();

export default function Landing() {
  return (
    <main className="ocean-grid masonry noise relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6">
      <div className="relative z-10 max-w-2xl text-center">
        <div className="ornament mx-auto mb-6 max-w-md">ordo machina</div>

        <div className="flex items-center justify-center gap-4">
          <span className="inline-block h-3 w-3 rotate-45 bg-phos shadow-[0_0_16px_rgba(232,230,225,0.8)]" />
          <h1 className="font-gothic text-8xl tracking-[0.08em] text-phos glow-bone candle">Cast</h1>
          <span className="blink font-term text-5xl text-phos">▊</span>
        </div>

        <p className="mt-5 font-mono text-sm uppercase tracking-[0.3em] text-cy">
          See the market · Throw a net · Discover your catch
        </p>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted">
          Pick an amount of SOL — CAST spreads it across a random, filtered set of Solana tokens.
          Watch your catch swim in the ocean. Pull out when you&apos;re done.
        </p>

        <div className="mt-9 flex items-center justify-center gap-3">
          <Link href="/ocean">
            <Button variant="primary" className="px-10 py-3 text-base">ENTER THE NAVE</Button>
          </Link>
        </div>

        <div className="mt-12 grid grid-cols-3 gap-3 text-left">
          <Feature title="See market" text="A living sonar of real tokens — size, momentum, liquidity at a glance." />
          <Feature title="Cast" text="One click spreads your SOL across a random filtered pool. Seeded, reproducible." />
          <Feature title="Pull out" text="Sell one fish, the winners, the losers — or the whole catch." />
        </div>

        <div className="ornament mx-auto mt-10 max-w-md">✦</div>

        <div className="mt-4 font-mono text-[10px] uppercase tracking-widest text-dim">
          phase 3 · simulation · no real funds
        </div>
      </div>

      {/* cemetery fence */}
      <div className="pointer-events-none absolute bottom-3 left-0 right-0 select-none overflow-hidden text-center font-mono text-[10px] leading-none tracking-[0.35em] text-dim/60">
        {FENCE}
      </div>
    </main>
  );
}

function Feature({ title, text }: { title: string; text: string }) {
  return (
    <div className="etched corner-gem bg-panel/70 p-3 backdrop-blur">
      <div className="font-mono text-xs font-bold uppercase tracking-wider text-phos">[ {title} ]</div>
      <div className="mt-1 text-[11px] leading-relaxed text-muted">{text}</div>
    </div>
  );
}
