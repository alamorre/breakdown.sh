export function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="not-prose my-6 overflow-x-auto rounded-md border border-zinc-700 bg-zinc-950 p-4 font-mono text-sm leading-6 text-zinc-50 shadow-sm dark:border-zinc-700 dark:bg-zinc-950">
      <code className="text-inherit">{children}</code>
    </pre>
  );
}
