import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from 'sonner';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { PreviewEnvironmentBanner } from '@/components/shared/PreviewEnvironmentBanner';
import '@/app/globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Thesis — Reasoning that propagates',
  description: 'A node-based reasoning canvas for structured decision-making',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
        <body className="min-h-full flex flex-col">
          <PreviewEnvironmentBanner />
          <ErrorBoundary>{children}</ErrorBoundary>
          <Toaster position="bottom-right" />
        </body>
      </html>
    </ClerkProvider>
  );
}
