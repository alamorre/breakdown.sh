import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service | breakdown.sh',
  description: 'Terms of Service for breakdown.sh',
};

const updatedAt = 'June 2, 2026';

export default function TermsOfServicePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
        <header className="border-b pb-8">
          <Link
            href="/"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            breakdown.sh
          </Link>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">Terms of Service</h1>
          <p className="mt-3 text-sm text-muted-foreground">Last updated: {updatedAt}</p>
        </header>

        <div className="prose prose-neutral mt-8 max-w-none dark:prose-invert">
          <p>
            These Terms of Service govern your access to and use of breakdown.sh and related
            services. By using Breakdown, you agree to these Terms.
          </p>

          <h2>The Service</h2>
          <p>
            Breakdown is a node-based reasoning canvas for creating analysis graphs, connecting
            source material, and generating outputs from prompts and selected data sources. Features
            may change over time.
          </p>

          <h2>Your Account</h2>
          <p>
            You are responsible for your account, credentials, and all activity under your account.
            You must provide accurate information and keep your account secure. You may not share
            access in a way that violates these Terms or any applicable third-party terms.
          </p>

          <h2>Your Content and Permissions</h2>
          <p>
            You retain ownership of content you submit, connect, or generate through Breakdown. You
            grant Breakdown a limited license to host, process, transmit, display, and otherwise use
            your content as needed to provide, secure, and improve the service.
          </p>
          <p>
            You represent that you have the rights and permissions needed to submit, connect, fetch,
            process, and analyze any content you use with Breakdown, including Google Drive files.
          </p>

          <h2>Google Drive</h2>
          <p>
            If you connect Google Drive, you authorize Breakdown to access selected Google Drive
            files through Google OAuth and Google Picker so the files can be used as source material
            in your graphs. You can disconnect Google Drive in Breakdown settings or revoke access
            through your Google Account.
          </p>

          <h2>AI Outputs</h2>
          <p>
            Breakdown may use third-party AI model providers to generate outputs. AI outputs can be
            inaccurate, incomplete, or unsuitable for your use case. You are responsible for
            reviewing outputs before relying on them. Breakdown does not provide legal, financial,
            medical, or other professional advice.
          </p>

          <h2>Acceptable Use</h2>
          <p>You agree not to use Breakdown to:</p>
          <ul>
            <li>Violate laws, regulations, third-party rights, or platform policies.</li>
            <li>Upload, connect, or process content you are not authorized to use.</li>
            <li>Attempt to access another user&apos;s account, data, systems, or files.</li>
            <li>Interfere with, disrupt, reverse engineer, or abuse the service.</li>
            <li>Transmit malware, harmful code, or deceptive content.</li>
            <li>
              Use the service to build or operate unlawful surveillance or advertising profiles.
            </li>
          </ul>

          <h2>Third-Party Services</h2>
          <p>
            Breakdown relies on third-party services, including authentication, hosting, database,
            Google APIs, and AI model providers. Your use of those integrations may be subject to
            their separate terms and policies.
          </p>

          <h2>Privacy</h2>
          <p>
            Our <Link href="/privacy">Privacy Policy</Link> explains how we collect, use, store, and
            share information. By using Breakdown, you also agree to the Privacy Policy.
          </p>

          <h2>Service Changes and Availability</h2>
          <p>
            We may modify, suspend, or discontinue any part of Breakdown at any time. We do not
            guarantee that the service will be uninterrupted, error-free, or available in every
            location.
          </p>

          <h2>Disclaimers</h2>
          <p>
            Breakdown is provided &quot;as is&quot; and &quot;as available&quot; without warranties
            of any kind, whether express, implied, or statutory, including warranties of
            merchantability, fitness for a particular purpose, title, and non-infringement.
          </p>

          <h2>Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, Breakdown and its operators will not be liable
            for indirect, incidental, special, consequential, exemplary, or punitive damages, or for
            lost profits, lost data, or business interruption arising from your use of the service.
          </p>

          <h2>Termination</h2>
          <p>
            You may stop using Breakdown at any time. We may suspend or terminate access if you
            violate these Terms, create risk for the service or other users, or if required by law.
          </p>

          <h2>Changes to These Terms</h2>
          <p>
            We may update these Terms from time to time. If changes are material, we will provide
            notice when appropriate. Continued use of Breakdown after changes become effective means
            you accept the updated Terms.
          </p>

          <h2>Contact</h2>
          <p>
            Questions about these Terms can be sent to{' '}
            <a href="mailto:alamorre@gmail.com">alamorre@gmail.com</a>.
          </p>
        </div>
      </article>
    </main>
  );
}
