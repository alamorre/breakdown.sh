import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy | breakdown.sh',
  description: 'Privacy Policy for breakdown.sh',
};

const updatedAt = 'June 2, 2026';

export default function PrivacyPage() {
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
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">Privacy Policy</h1>
          <p className="mt-3 text-sm text-muted-foreground">Last updated: {updatedAt}</p>
        </header>

        <div className="prose prose-neutral mt-8 max-w-none dark:prose-invert">
          <p>
            Breakdown is a reasoning canvas for structuring decisions, connecting source material,
            and running analysis across a directed graph. This Privacy Policy explains how
            breakdown.sh collects, uses, stores, and shares information when you use the service.
          </p>

          <h2>Information We Collect</h2>
          <p>We collect information you provide or authorize us to access, including:</p>
          <ul>
            <li>
              Account information, such as your name, email address, and authentication details.
            </li>
            <li>
              Graph content, including nodes, prompts, source URLs, uploaded or pasted text, model
              selections, run status, and generated outputs.
            </li>
            <li>
              Google Drive information, if you connect Google Drive, including your connected Google
              account email, selected file IDs, file names, MIME types, Drive links, file metadata,
              OAuth tokens, and the content of files you choose to fetch into Breakdown.
            </li>
            <li>
              Usage and technical information, such as log data, device/browser information,
              diagnostics, and security events.
            </li>
          </ul>

          <h2>Google Drive Data</h2>
          <p>
            Breakdown uses Google OAuth and Google Picker so you can choose specific Google Docs,
            Sheets, and Presentations to use as source nodes. Breakdown requests the{' '}
            <code>https://www.googleapis.com/auth/drive.file</code> scope, which is intended to
            limit access to files you select or otherwise use with the app.
          </p>
          <p>We use Google Drive data only to provide user-facing Breakdown features, including:</p>
          <ul>
            <li>Showing selected file names and metadata in your graph.</li>
            <li>
              Fetching selected file contents into source nodes when you ask us to refresh them.
            </li>
            <li>Using selected file contents as context for graph analysis that you initiate.</li>
            <li>Maintaining connection status, reconnect, disconnect, and permission states.</li>
          </ul>
          <p>
            Breakdown does not sell Google user data. Breakdown does not use Google Drive data for
            advertising, retargeting, personalized ads, creditworthiness, lending, or unrelated
            third-party data products.
          </p>
          <p>
            Breakdown&apos;s use and transfer of information received from Google APIs will adhere
            to the{' '}
            <a href="https://developers.google.com/terms/api-services-user-data-policy">
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>

          <h2>How We Use Information</h2>
          <p>We use information to:</p>
          <ul>
            <li>Provide, operate, maintain, secure, and improve Breakdown.</li>
            <li>Authenticate users and protect accounts.</li>
            <li>Create, save, refresh, and run graph nodes and source material.</li>
            <li>Generate analysis and outputs requested by you.</li>
            <li>Debug errors, prevent abuse, and monitor service reliability.</li>
            <li>Comply with legal obligations and enforce our terms.</li>
          </ul>

          <h2>AI Processing</h2>
          <p>
            When you run analysis, Breakdown may send prompts, graph context, selected source
            content, and related outputs to the AI model provider you select to generate the
            requested result. Do not connect or submit content that you are not authorized to
            process with Breakdown or its service providers.
          </p>

          <h2>How We Share Information</h2>
          <p>We share information only as needed to provide and protect the service, including:</p>
          <ul>
            <li>
              With infrastructure, database, authentication, hosting, and AI service providers.
            </li>
            <li>With Google APIs when you connect or reconnect your Google Drive account.</li>
            <li>
              When required by law, legal process, or to protect rights, safety, and security.
            </li>
            <li>In connection with a merger, acquisition, financing, or sale of assets.</li>
          </ul>

          <h2>Security</h2>
          <p>
            We use reasonable technical and organizational measures designed to protect information,
            including HTTPS in transit, access controls, and encrypted storage of Google Drive
            refresh tokens. No system is perfectly secure, and we cannot guarantee absolute
            security.
          </p>

          <h2>Retention and Deletion</h2>
          <p>
            We retain information for as long as needed to provide Breakdown, comply with legal
            obligations, resolve disputes, and enforce agreements. You can remove graph content from
            the app, disconnect Google Drive in settings, and revoke Breakdown&apos;s Google access
            from your Google Account permissions page.
          </p>

          <h2>Your Choices</h2>
          <ul>
            <li>You can choose which Google Drive files to connect through Google Picker.</li>
            <li>You can disconnect Google Drive from Breakdown settings.</li>
            <li>You can revoke Google API access from your Google Account.</li>
            <li>You can contact us to request access, correction, or deletion of personal data.</li>
          </ul>

          <h2>Children</h2>
          <p>
            Breakdown is not directed to children under 13, and we do not knowingly collect personal
            information from children under 13.
          </p>

          <h2>Changes</h2>
          <p>
            We may update this Privacy Policy from time to time. If we make material changes, we
            will update the date above and provide additional notice when appropriate.
          </p>

          <h2>Contact</h2>
          <p>
            For privacy questions or requests, contact{' '}
            <a href="mailto:alamorre@gmail.com">alamorre@gmail.com</a>.
          </p>
        </div>
      </article>
    </main>
  );
}
