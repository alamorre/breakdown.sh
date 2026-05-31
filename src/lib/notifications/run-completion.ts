import { toast } from 'sonner';

const RUN_COMPLETION_TITLE = 'Reasoning chain complete';
const TAB_TITLE_PREFIX = '[Done] ';

let restoreTabTitle: (() => void) | null = null;

interface RunCompletionOptions {
  graphName: string;
  nodeCount: number;
  url?: string;
}

export function getRunCompletionDescription(graphName: string, nodeCount: number) {
  const nodeLabel = nodeCount === 1 ? 'node' : 'nodes';
  return `${graphName} finished running ${nodeCount} ${nodeLabel}.`;
}

export function notifyRunCompletion({ graphName, nodeCount, url }: RunCompletionOptions) {
  const description = getRunCompletionDescription(graphName, nodeCount);

  toast.success(RUN_COMPLETION_TITLE, {
    description,
    id: 'run-completion',
  });

  void notifyBrowserWhenUnfocused(description, url);
}

async function notifyBrowserWhenUnfocused(body: string, url?: string) {
  if (!isWindowUnfocused()) return;

  const notificationShown = await showBrowserNotification(body, url);
  if (!notificationShown) {
    showTabTitleBadge();
  }
}

function isWindowUnfocused() {
  if (typeof document === 'undefined') return false;

  return document.visibilityState !== 'visible' || !document.hasFocus();
}

async function showBrowserNotification(body: string, url?: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;

  const notificationApi = window.Notification;
  if (!notificationApi) return false;

  let permission = notificationApi.permission;

  if (permission === 'default') {
    try {
      permission = await notificationApi.requestPermission();
    } catch {
      permission = notificationApi.permission;
    }
  }

  if (permission !== 'granted') return false;

  const notification = new notificationApi(RUN_COMPLETION_TITLE, {
    body,
    tag: 'thesis-run-completion',
  });

  notification.onclick = () => {
    window.focus();
    if (url && window.location.href !== url) {
      window.location.assign(url);
    }
    notification.close();
  };

  return true;
}

function showTabTitleBadge() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  restoreTabTitle?.();

  const originalTitle = document.title;
  const badgedTitle = originalTitle.startsWith(TAB_TITLE_PREFIX)
    ? originalTitle
    : `${TAB_TITLE_PREFIX}${originalTitle}`;

  document.title = badgedTitle;

  const restore = () => {
    if (document.title === badgedTitle) {
      document.title = originalTitle;
    }
    window.removeEventListener('focus', restore);
    document.removeEventListener('visibilitychange', restoreWhenVisible);
    restoreTabTitle = null;
  };

  const restoreWhenVisible = () => {
    if (document.visibilityState === 'visible' && document.hasFocus()) {
      restore();
    }
  };

  window.addEventListener('focus', restore, { once: true });
  document.addEventListener('visibilitychange', restoreWhenVisible);
  restoreTabTitle = restore;
}
