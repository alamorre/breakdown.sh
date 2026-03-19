import { UserButton } from '@clerk/nextjs';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <span className="text-lg font-semibold tracking-tight">Thesis</span>
        <UserButton />
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
