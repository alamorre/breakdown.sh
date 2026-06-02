import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-16">
        <div className="space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">breakdown.sh</p>
            <h1 className="text-4xl font-semibold tracking-normal sm:text-5xl">
              Reasoning that propagates.
            </h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground">
              Breakdown is a node-based reasoning canvas for structuring decisions, connecting
              source material, and running analysis across a directed graph.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 text-sm">
            <Link
              href="/sign-in"
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Sign in
            </Link>
            <Link
              href="/privacy"
              className="inline-flex h-10 items-center justify-center rounded-md border px-4 font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Privacy
            </Link>
            <Link
              href="/terms-of-service"
              className="inline-flex h-10 items-center justify-center rounded-md border px-4 font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Terms
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
