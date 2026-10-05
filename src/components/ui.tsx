import { cn } from '@/lib/utils';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

export function Button({
  className,
  variant = 'default',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'ghost' | 'danger' | 'primary' }) {
  return (
    <button
      className={cn(
        'border px-4 py-2 font-mono text-sm uppercase tracking-[0.15em] transition-all disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'default' && 'border-line bg-phos/5 text-phos hover:bg-phos/15',
        variant === 'primary' &&
          'border-phos bg-phos font-bold text-black shadow-[0_0_20px_rgba(232,230,225,0.35)] hover:shadow-[0_0_34px_rgba(232,230,225,0.55)]',
        variant === 'ghost' && 'border-transparent text-muted hover:text-phos',
        variant === 'danger' && 'border-danger/50 bg-danger/10 text-danger hover:bg-danger/20',
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('etched corner-gem bg-panel p-4', className)} {...props} />;
}

export function Badge({
  className,
  tone = 'neutral',
  children,
}: {
  className?: string;
  tone?: 'neutral' | 'green' | 'red' | 'violet' | 'amber' | 'cyan';
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider',
        tone === 'neutral' && 'border-line bg-white/5 text-muted',
        tone === 'green' && 'border-phos/40 bg-phos/10 text-phos',      // bone
        tone === 'red' && 'border-danger/40 bg-danger/10 text-danger',  // ash
        tone === 'violet' && 'border-violet/40 bg-violet/10 text-violet',
        tone === 'amber' && 'border-phos/40 bg-phos/10 text-phos',      // bone
        tone === 'cyan' && 'border-cy/40 bg-cy/10 text-cy',             // silver
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted">[ {label} ]</div>
      <div
        className={cn(
          'font-mono text-base',
          tone === 'green' && 'text-profit',
          tone === 'red' && 'text-loss',
          !tone && 'text-white',
        )}
      >
        {tone === 'red' && value !== '—' ? `${value} ☠` : value}
      </div>
    </div>
  );
}
