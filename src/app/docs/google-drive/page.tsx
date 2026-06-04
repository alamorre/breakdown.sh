import type { Metadata } from 'next';

import { DocsBreadcrumb } from '@/components/docs/DocsBreadcrumb';
import { DocsProse } from '@/components/docs/DocsProse';

export const metadata: Metadata = {
  title: 'Google Drive Sources | breakdown.sh',
  description: 'How Breakdown uses selected Google Drive files as graph source material.',
};

const sourceTypes = [
  ['Docs', 'Exported as Markdown or plain text for graph context.'],
  ['Sheets', 'Fetched as bounded table content for prompts and downstream analysis.'],
  ['Presentations', 'Exported as slide text for source refreshes.'],
];

const setupItems = [
  'Enable the Google Drive API in the Google Cloud project used by the app.',
  'Configure an OAuth consent screen with openid, email, profile, and drive.file scopes.',
  'Add the hosted and local callback URLs for /api/integrations/google-drive/callback.',
  'Restrict the Picker API key to the app origins that will load the browser picker.',
  'Apply the google_drive_connections database migration before connecting hosted users.',
  'Set the Google Drive and encryption environment variables before building the app.',
];

export default function GoogleDriveDocsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
        <header className="border-b pb-8">
          <DocsBreadcrumb />
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">Google Drive Sources</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            Breakdown connects to Google Drive so users can select specific Docs, Sheets, and
            Presentations as source nodes in a reasoning graph.
          </p>
        </header>

        <DocsProse className="mt-8">
          <h2>User Flow</h2>
          <ol>
            <li>Open a graph and add a Google Drive source.</li>
            <li>Connect Google Drive if the account is not connected yet.</li>
            <li>Select one or more files in Google Picker.</li>
            <li>Breakdown creates one source node for each selected file.</li>
            <li>Refresh a source node or run the graph to fetch current file contents.</li>
          </ol>

          <h2>Access Model</h2>
          <p>
            Breakdown uses the <code>https://www.googleapis.com/auth/drive.file</code> scope. That
            keeps access focused on files the user selects or otherwise uses with the app rather
            than broad Drive browsing.
          </p>
          <p>
            Refresh tokens are stored server-side and encrypted. The browser receives only the
            access needed to open Google Picker and select files.
          </p>
        </DocsProse>

        <div className="mt-8 overflow-hidden rounded-md border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="border-b px-4 py-3 font-medium">File Type</th>
                <th className="border-b px-4 py-3 font-medium">How It Is Used</th>
              </tr>
            </thead>
            <tbody>
              {sourceTypes.map(([type, use]) => (
                <tr key={type} className="border-b last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{type}</td>
                  <td className="px-4 py-3 text-muted-foreground">{use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DocsProse className="mt-8">
          <h2>Deployment Checklist</h2>
          <ul>
            {setupItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          <h2>Smoke Test</h2>
          <ol>
            <li>Open a graph in the hosted app.</li>
            <li>Add a Google Drive source.</li>
            <li>Connect Google Drive if prompted.</li>
            <li>Pick one private Doc, Sheet, and Presentation.</li>
            <li>Refresh each source without making the file public.</li>
          </ol>
        </DocsProse>
      </article>
    </main>
  );
}
