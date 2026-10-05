import type { Metadata } from 'next';
import { VT323, IBM_Plex_Mono, UnifrakturMaguntia } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { StatusBar } from '@/components/status-bar';
import { BootGate } from '@/components/boot-screen';

const vt323 = VT323({ weight: '400', subsets: ['latin'], variable: '--font-vt323' });
const plex = IBM_Plex_Mono({ weight: ['400', '500', '700'], subsets: ['latin'], variable: '--font-plex' });
const gothic = UnifrakturMaguntia({ weight: '400', subsets: ['latin'], variable: '--font-gothic' });

export const metadata: Metadata = {
  title: 'SANCTUM-84 — gothic sonar of the token ocean',
  description: 'Visual market exploration for Solana. See the market, cast, discover your catch.',
};

/** Безель собора: каменная рама, ромбы-орнаменты, шильдик. */
function Bezel() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[60]">
      <div className="absolute inset-0 border-[10px] border-[#1B1B1E80]" />
      <div className="absolute inset-[10px] border border-line" />
      {/* ромбы по углам вместо винтов */}
      {['left-3 top-3', 'right-3 top-3', 'left-3 bottom-3', 'right-3 bottom-3'].map((pos) => (
        <div key={pos} className={`absolute ${pos} h-1.5 w-1.5 rotate-45 bg-[#4A4A50]`} />
      ))}
      {/* шильдик */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 border border-line bg-panel px-3 py-0.5 font-mono text-[9px] uppercase tracking-[0.35em] text-muted">
        SANCTUM-84 · ordo machina
      </div>
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${vt323.variable} ${plex.variable} ${gothic.variable}`}>
      <body className="crt-flicker antialiased">
        <Providers>
          <StatusBar />
          <div className="pt-9">
            <BootGate>{children}</BootGate>
          </div>
          <Bezel />
          {/* туман + CRT overlays */}
          <div className="fog-a pointer-events-none fixed inset-0 z-[62]" />
          <div className="fog-b pointer-events-none fixed inset-0 z-[62]" />
          <div className="crt-vignette pointer-events-none fixed inset-0 z-[65]" />
          <div className="crt-scanlines pointer-events-none fixed inset-0 z-[70]" />
        </Providers>
      </body>
    </html>
  );
}
