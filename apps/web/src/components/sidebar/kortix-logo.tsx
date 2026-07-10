'use client';

import { cn } from '@/lib/utils';

interface KortixLogoProps {
  size?: number;
  variant?: 'symbol' | 'logomark';
  className?: string;
}

export function KortixLogo({
  size = 24,
  variant = 'symbol',
  className,
}: KortixLogoProps) {
  if (variant === 'logomark') {
    return (
      <img
        src="/vaelonx-logomark-white.png"
        alt="VaelonX"
        className={cn('flex-shrink-0', className)}
        style={{ height: `${size}px`, width: 'auto' }}
      />
    );
  }

  return (
    <img
      src="/favicon.png"
      alt="VaelonX"
      className={cn('flex-shrink-0', className)}
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  );
}
