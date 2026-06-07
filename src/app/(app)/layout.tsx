import { UserButton } from '@clerk/nextjs';
import Link from 'next/link';

const navLinkClassName =
  'inline-flex h-7 shrink-0 items-center justify-center rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] font-medium whitespace-nowrap transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between gap-4 border-b border-border px-4 sm:px-6">
        <Link href="/dashboard" className="text-lg font-semibold tracking-tight">
          breakdown.sh
        </Link>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <Link href="/docs" className={navLinkClassName}>
            Docs
          </Link>
          <Link href="/settings" className={navLinkClassName}>
            Settings
          </Link>
          <UserButton />
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
