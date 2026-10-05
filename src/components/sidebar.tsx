'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useCastStore } from '@/lib/store';
import { WalletConnect } from '@/components/wallet-connect';
import { fmtSol } from '@/lib/format';

const NAV = [
  { href: '/ocean', label: 'OCEAN' },
  { href: '/catches', label: 'CATCHES' },
  { href: '/discover', label: 'DISCOVER' },
  { href: '/leaders', label: 'LEADERS' },
  { href: '/profile', label: 'PROFILE' },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const catches = useCastStore((s) => s.catches.length);
  const simBalance = useCastStore((s) => s.walletBalanceSol);

  return (
    <aside className="fixed bottom-0 left-0 top-9 z-40 flex w-52 flex-col border-r border-line bg-panel/85 backdrop-blur">
      <Link href="/" className="flex items-center gap-2 border-b border-line px-5 py-4">
        <span className="inline-block h-2 w-2 rotate-45 bg-phos shadow-[0_0_10px_rgba(232,230,225,0.8)]" />
        <span className="font-gothic text-2xl tracking-[0.15em] text-phos glow-bone candle">Cast</span>
      </Link>

      <nav className="mt-3 flex flex-col gap-0.5 px-3 font-mono text-[15px]">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center justify-between border-l-2 px-3 py-2 tracking-[0.15em] transition-colors',
                active
                  ? 'border-phos bg-phos/10 text-phos'
                  : 'border-transparent text-muted hover:bg-phos/5 hover:text-phos',
              )}
            >
              <span>{item.label}</span>
              {item.href === '/catches' && catches > 0 && (
                <span className="text-[10px] text-cy">{catches}</span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mx-3 mt-3 flex-1 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/side-2.jpg"
          alt=""
          className="h-full w-full object-contain opacity-80 grayscale"
        />
      </div>

      <div className="mt-auto space-y-2 border-t border-line p-4 font-mono text-xs uppercase tracking-wider text-muted">
        <div className="ornament">✦</div>
        <WalletConnect />
      </div>
    </aside>
  );
}
