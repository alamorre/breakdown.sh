import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-16">
        <div className="space-y-8">
          <div className="space-y-4">
            <p className="text-sm font-medium text-muted-foreground">A bicycle for the LLM</p>
            <h1 className="text-4xl font-semibold tracking-normal sm:text-5xl">breakdown.sh</h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground">
              breakdown.sh is an AI reasoning canvas that helps users organize source material,
              build directed analysis graphs, and generate answers from connected inputs.
            </p>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground">
              Users can connect selected Google Drive Docs, Sheets, and Presentations as source
              nodes, refresh those sources on demand, and use their contents only for analysis the
              user initiates inside their graph.
            </p>
          </div>

          <div className="grid gap-3 border-l pl-4 text-sm text-muted-foreground">
            <p>
              Purpose: help users break down research, decisions, and source documents into a
              structured graph of inputs and AI-assisted reasoning steps.
            </p>
            <p>
              Google Drive access: limited to files the user selects with Google Picker for use as
              graph source material.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 text-sm">
            <Link
              href="/sign-in?redirect_url=/dashboard"
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Sign in
            </Link>
            <Link
              href="/docs"
              className="inline-flex h-10 items-center justify-center rounded-md border px-4 font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Docs
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
