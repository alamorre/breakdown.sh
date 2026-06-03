This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, enable Corepack and install dependencies with the pinned pnpm version:

```bash
corepack enable
pnpm install
```

Then run the development server:

```bash
pnpm dev:secrets
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Environment Secrets

Runtime configuration is managed in Doppler. Use `.env.local.example` as the
variable inventory, but do not put real secret values in the repo.

For first-time setup:

```bash
brew install gnupg
brew install dopplerhq/cli/doppler
doppler login
doppler setup
pnpm dev:secrets
```

See [docs/secrets-management.md](docs/secrets-management.md) for the local,
staging, and production workflow.

## Package Security

This project uses pnpm with a seven-day release cooldown. Dependency resolution is configured in `pnpm-workspace.yaml` with `minimumReleaseAge: 10080`, strict fallback behavior, and no bypass for registry metadata that is missing publish times.

Run `pnpm run audit:high` before dependency changes. The PR checks include the same high-severity audit, and patched transitive dependency overrides live in `pnpm-workspace.yaml`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
