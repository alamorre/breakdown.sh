'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  GOOGLE_DRIVE_MIME_TYPES,
  isSupportedGoogleDriveMimeType,
  type PickedGoogleDriveFile,
} from '@/lib/integrations/google-drive/source';

type PickerTokenResponse = {
  accessToken: string;
  apiKey: string;
  appId: string;
  connection: {
    id: string;
    accountEmail: string;
  };
};

type GoogleDriveStatusResponse = {
  configured: boolean;
  connected: boolean;
  connection: {
    id: string;
    accountEmail: string;
  } | null;
  error?: string;
};

type PickerDocument = {
  id?: string;
  name?: string;
  mimeType?: string;
  url?: string;
  iconUrl?: string;
};

type PickerCallbackData = {
  action?: string;
  docs?: PickerDocument[];
  [key: string]: unknown;
};

type GooglePickerNamespace = {
  Action?: { PICKED?: string };
  DocsView: new () => {
    setMimeTypes: (mimeTypes: string) => unknown;
    setIncludeFolders?: (includeFolders: boolean) => unknown;
    setSelectFolderEnabled?: (selectFolderEnabled: boolean) => unknown;
  };
  Feature?: { MULTISELECT_ENABLED?: string };
  PickerBuilder: new () => {
    setAppId: (appId: string) => GooglePickerNamespace['PickerBuilder']['prototype'];
    setOAuthToken: (accessToken: string) => GooglePickerNamespace['PickerBuilder']['prototype'];
    setDeveloperKey: (apiKey: string) => GooglePickerNamespace['PickerBuilder']['prototype'];
    enableFeature: (feature: string) => GooglePickerNamespace['PickerBuilder']['prototype'];
    addView: (view: unknown) => GooglePickerNamespace['PickerBuilder']['prototype'];
    setCallback: (
      callback: (data: PickerCallbackData) => void,
    ) => GooglePickerNamespace['PickerBuilder']['prototype'];
    build: () => { setVisible: (visible: boolean) => void };
  };
  Response?: {
    ACTION?: string;
    DOCUMENTS?: string;
  };
};

declare global {
  interface Window {
    gapi?: {
      load: (
        apiName: string,
        options: {
          callback: () => void;
          onerror?: () => void;
          timeout?: number;
          ontimeout?: () => void;
        },
      ) => void;
    };
    google?: {
      picker?: GooglePickerNamespace;
    };
  }
}

let pickerApiPromise: Promise<void> | null = null;

function loadGooglePickerApi(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Picker requires a browser'));
  }

  if (window.google?.picker && window.gapi) {
    return Promise.resolve();
  }

  if (pickerApiPromise) {
    return pickerApiPromise;
  }

  pickerApiPromise = new Promise((resolve, reject) => {
    const loadPicker = () => {
      if (!window.gapi) {
        reject(new Error('Google API script did not load'));
        return;
      }

      window.gapi.load('picker', {
        callback: resolve,
        onerror: () => reject(new Error('Failed to load Google Picker')),
        timeout: 10_000,
        ontimeout: () => reject(new Error('Timed out loading Google Picker')),
      });
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://apis.google.com/js/api.js"]',
    );
    if (existingScript) {
      if (window.gapi) {
        loadPicker();
        return;
      }

      existingScript.addEventListener('load', loadPicker, { once: true });
      existingScript.addEventListener(
        'error',
        () => reject(new Error('Failed to load Google API script')),
        {
          once: true,
        },
      );
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.defer = true;
    script.onload = loadPicker;
    script.onerror = () => reject(new Error('Failed to load Google API script'));
    document.head.appendChild(script);
  });

  return pickerApiPromise;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !data) {
    throw new Error(data?.error ?? 'Google Drive request failed');
  }

  return data;
}

function normalizePickerDocuments(data: PickerCallbackData): PickedGoogleDriveFile[] {
  const picker = window.google?.picker;
  const documentsKey = picker?.Response?.DOCUMENTS ?? 'docs';
  const documents = (data[documentsKey] ?? data.docs ?? []) as PickerDocument[];
  const files: PickedGoogleDriveFile[] = [];

  for (const document of documents) {
    const mimeType = document.mimeType;
    if (!document.id || !document.url || !mimeType || !isSupportedGoogleDriveMimeType(mimeType)) {
      continue;
    }

    files.push({
      fileId: document.id,
      name: document.name ?? 'Untitled Drive file',
      mimeType,
      url: document.url,
      ...(document.iconUrl ? { iconUrl: document.iconUrl } : {}),
    });
  }

  return files;
}

function buildPicker(
  input: PickerTokenResponse,
  onPicked: (files: PickedGoogleDriveFile[]) => void,
) {
  const picker = window.google?.picker;
  if (!picker) {
    throw new Error('Google Picker is not available');
  }

  const mimeTypes = Object.values(GOOGLE_DRIVE_MIME_TYPES).join(',');
  const view = new picker.DocsView();
  view.setMimeTypes(mimeTypes);
  view.setIncludeFolders?.(false);
  view.setSelectFolderEnabled?.(false);

  const builder = new picker.PickerBuilder()
    .setAppId(input.appId)
    .setDeveloperKey(input.apiKey)
    .setOAuthToken(input.accessToken)
    .addView(view)
    .setCallback((data: PickerCallbackData) => {
      const actionKey = picker.Response?.ACTION ?? 'action';
      const action = (data[actionKey] ?? data.action) as string | undefined;
      if (action !== (picker.Action?.PICKED ?? 'picked')) {
        return;
      }

      const files = normalizePickerDocuments(data);
      if (files.length === 0) {
        toast.warning('No supported Google Drive files selected');
        return;
      }
      onPicked(files);
    });

  const multiSelectFeature = picker.Feature?.MULTISELECT_ENABLED;
  if (multiSelectFeature) {
    builder.enableFeature(multiSelectFeature);
  }

  builder.build().setVisible(true);
}

export function useGoogleDrivePicker(input: {
  onPicked: (files: PickedGoogleDriveFile[]) => Promise<void> | void;
}): { openPicker: () => Promise<void>; dialog: ReactNode; loading: boolean } {
  const pathname = usePathname();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'connect' | 'not-configured'>('connect');
  const [loading, setLoading] = useState(false);

  const connectHref = `/api/integrations/google-drive/connect?returnTo=${encodeURIComponent(pathname)}`;

  const openPicker = useCallback(async () => {
    setLoading(true);
    try {
      const status = await fetchJson<GoogleDriveStatusResponse>(
        '/api/integrations/google-drive/status',
      );
      if (!status.configured) {
        setDialogMode('not-configured');
        setDialogOpen(true);
        return;
      }

      if (!status.connected) {
        setDialogMode('connect');
        setDialogOpen(true);
        return;
      }

      const token = await fetchJson<PickerTokenResponse>(
        '/api/integrations/google-drive/picker-token',
        {
          method: 'POST',
        },
      );
      await loadGooglePickerApi();
      buildPicker(token, input.onPicked);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open Google Drive';
      if (message.includes('connected') || message.includes('Reconnect')) {
        setDialogMode('connect');
        setDialogOpen(true);
      } else {
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  }, [input.onPicked]);

  const dialog = (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {dialogMode === 'not-configured' ? 'Configure Google Drive' : 'Connect Google Drive'}
          </DialogTitle>
          <DialogDescription>
            {dialogMode === 'not-configured'
              ? 'Google Drive environment variables are not configured for this deployment.'
              : 'Connect Google Drive to pick private Docs, Sheets, and Presentations without making them public.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogOpen(false)}>
            Cancel
          </Button>
          {dialogMode === 'connect' && (
            <a className={buttonVariants()} href={connectHref}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              Connect Drive
            </a>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { openPicker, dialog, loading };
}
