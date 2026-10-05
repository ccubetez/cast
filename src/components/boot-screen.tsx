'use client';

import { useEffect, useState } from 'react';
import { useCastStore } from '@/lib/store';

const BOOT_LINES = [
  'SANCTUM-84 · ORDO MACHINA v1.2',
  '────────────────────── ✦ ──────────────────────',
  'MEM ......... 640K OK',
  'CANDLES ..... LIT',
  'SPIRIT GLASS  POLISHED',
  'SONAR ARRAY . ONLINE',
  'TOKEN FEED .. CONNECTED',
  'RNG ......... BLESSED',
  '────────────────────── ✦ ──────────────────────',
  '',
  '> ENTERING THE NAVE_',
];

const SESSION_KEY = 'cast-booted';

/** Boot: CRT-включение + литания самотеста. Раз за сессию, скип по клику. */
export function BootGate({ children }: { children: React.ReactNode }) {
  const [stage, setStage] = useState<'check' | 'crt' | 'lines' | 'done'>('check');
  const [lineCount, setLineCount] = useState(0);
  const [fading, setFading] = useState(false);
  const tokenCount = useCastStore((s) => s.tokens.length);

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY)) {
      setStage('done');
      return;
    }
    setStage('crt');
    const t1 = setTimeout(() => setStage('lines'), 950);
    return () => clearTimeout(t1);
  }, []);

  useEffect(() => {
    if (stage !== 'lines') return;
    if (lineCount >= BOOT_LINES.length) {
      const t = setTimeout(() => finish(), 800);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setLineCount((c) => c + 1), lineCount === 0 ? 150 : 190);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, lineCount]);

  const finish = () => {
    sessionStorage.setItem(SESSION_KEY, '1');
    setFading(true);
    setTimeout(() => setStage('done'), 450);
  };

  if (stage === 'done') return <>{children}</>;

  const lines = BOOT_LINES.slice(0, lineCount).map((l) =>
    l === 'TOKEN FEED .. CONNECTED' && tokenCount > 0 ? `TOKEN FEED .. ${tokenCount} SOULS TRACKED` : l,
  );

  return (
    <>
      {children}
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0A0A0B] transition-opacity duration-500"
        style={{ opacity: fading ? 0 : 1 }}
        onClick={finish}
      >
        <div className={stage !== 'check' ? 'crt-on w-[min(92vw,560px)]' : 'w-[min(92vw,560px)]'}>
          {stage === 'lines' && (
            <pre className="font-term text-lg leading-7 text-phos glow-bone">
              {lines.map((l, i) => (
                <div key={i} className="boot-line" style={{ animationDelay: `${i * 30}ms` }}>
                  {l}
                </div>
              ))}
              <span className="blink">▊</span>
            </pre>
          )}
          {stage === 'lines' && (
            <div className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-dim">
              click to skip
            </div>
          )}
        </div>
      </div>
    </>
  );
}
