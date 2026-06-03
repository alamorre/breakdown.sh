import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import {
  getRunCompletionDescription,
  notifyRunCompletion,
} from '@/lib/notifications/run-completion';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}));

type Listener = EventListenerOrEventListenerObject;

interface MutableDocument {
  title: string;
  visibilityState: DocumentVisibilityState;
  hasFocus: () => boolean;
  addEventListener: (event: string, listener: Listener) => void;
  removeEventListener: (event: string, listener: Listener) => void;
}

interface MutableWindow {
  Notification?: typeof Notification;
  focus: () => void;
  location: {
    href: string;
    assign: (url: string | URL) => void;
  };
  addEventListener: (event: string, listener: Listener, options?: AddEventListenerOptions) => void;
  removeEventListener: (event: string, listener: Listener) => void;
}

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

let activeBrowser: ReturnType<typeof installBrowserGlobals> | null = null;

afterEach(() => {
  activeBrowser?.emitWindow('focus');
  activeBrowser = null;

  restoreGlobal('document', originalDocument);
  restoreGlobal('window', originalWindow);
  vi.clearAllMocks();
});

describe('getRunCompletionDescription', () => {
  it('formats singular and plural node counts', () => {
    expect(getRunCompletionDescription('Research canvas', 1)).toBe(
      'Research canvas finished running 1 node.',
    );
    expect(getRunCompletionDescription('Research canvas', 3)).toBe(
      'Research canvas finished running 3 nodes.',
    );
  });
});

describe('notifyRunCompletion', () => {
  it('shows only the in-app toast when the document is focused', async () => {
    const notification = createNotificationApi('default', 'granted');
    activeBrowser = installBrowserGlobals({
      focused: true,
      notificationApi: notification.api,
      visible: true,
    });

    notifyRunCompletion({
      graphName: 'Research canvas',
      nodeCount: 3,
      url: 'https://app.test/graph/graph-1',
    });
    await flushPromises();

    expect(toast.success).toHaveBeenCalledWith('Reasoning chain complete', {
      description: 'Research canvas finished running 3 nodes.',
      id: 'run-completion',
    });
    expect(notification.requestPermission).not.toHaveBeenCalled();
    expect(notification.instances).toHaveLength(0);
  });

  it('shows a clickable browser notification when the unfocused document has permission', async () => {
    const notification = createNotificationApi('granted', 'granted');
    activeBrowser = installBrowserGlobals({
      focused: false,
      href: 'https://app.test/dashboard',
      notificationApi: notification.api,
      visible: false,
    });

    notifyRunCompletion({
      graphName: 'Research canvas',
      nodeCount: 2,
      url: 'https://app.test/graph/graph-1',
    });
    await flushPromises();

    expect(notification.requestPermission).not.toHaveBeenCalled();
    expect(notification.instances).toHaveLength(1);
    expect(notification.instances[0].title).toBe('Reasoning chain complete');
    expect(notification.instances[0].options).toMatchObject({
      body: 'Research canvas finished running 2 nodes.',
      tag: 'breakdown-run-completion',
    });

    notification.instances[0].onclick?.call(
      notification.instances[0] as unknown as Notification,
      {} as Event,
    );

    expect(activeBrowser.window.focus).toHaveBeenCalled();
    expect(activeBrowser.window.location.assign).toHaveBeenCalledWith(
      'https://app.test/graph/graph-1',
    );
    expect(notification.instances[0].close).toHaveBeenCalled();
  });

  it('requests permission only when unfocused and falls back to the tab title when denied', async () => {
    const notification = createNotificationApi('default', 'denied');
    activeBrowser = installBrowserGlobals({
      focused: false,
      notificationApi: notification.api,
      title: 'Breakdown',
      visible: false,
    });

    notifyRunCompletion({
      graphName: 'Research canvas',
      nodeCount: 4,
      url: 'https://app.test/graph/graph-1',
    });
    await flushPromises();

    expect(notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(notification.instances).toHaveLength(0);
    expect(activeBrowser.document.title).toBe('[Done] Breakdown');

    activeBrowser.setFocused(true);
    activeBrowser.setVisibility('visible');
    activeBrowser.emitDocument('visibilitychange');

    expect(activeBrowser.document.title).toBe('Breakdown');
  });
});

function createNotificationApi(
  initialPermission: NotificationPermission,
  requestResult: NotificationPermission,
) {
  const instances: TestNotification[] = [];

  class TestNotification {
    static permission: NotificationPermission = initialPermission;
    static requestPermission = vi.fn(async () => {
      TestNotification.permission = requestResult;
      return requestResult;
    });

    onclick: ((this: Notification, ev: Event) => unknown) | null = null;
    close = vi.fn();

    constructor(
      public title: string,
      public options?: NotificationOptions,
    ) {
      instances.push(this);
    }
  }

  return {
    api: TestNotification as unknown as typeof Notification,
    instances,
    requestPermission: TestNotification.requestPermission,
  };
}

function installBrowserGlobals({
  focused,
  href = 'https://app.test/graph/graph-1',
  notificationApi,
  title = 'Breakdown',
  visible,
}: {
  focused: boolean;
  href?: string;
  notificationApi: typeof Notification;
  title?: string;
  visible: boolean;
}) {
  let hasFocus = focused;
  const documentListeners = new Map<string, Set<Listener>>();
  const windowListeners = new Map<string, Set<Listener>>();

  const document: MutableDocument = {
    title,
    visibilityState: visible ? 'visible' : 'hidden',
    hasFocus: () => hasFocus,
    addEventListener: vi.fn((event, listener) => {
      addListener(documentListeners, event, listener);
    }),
    removeEventListener: vi.fn((event, listener) => {
      removeListener(documentListeners, event, listener);
    }),
  };

  const window: MutableWindow = {
    Notification: notificationApi,
    focus: vi.fn(),
    location: {
      href,
      assign: vi.fn(),
    },
    addEventListener: vi.fn((event, listener) => {
      addListener(windowListeners, event, listener);
    }),
    removeEventListener: vi.fn((event, listener) => {
      removeListener(windowListeners, event, listener);
    }),
  };

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: document as unknown as Document,
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: window as unknown as Window,
  });

  return {
    document,
    window,
    emitDocument: (event: string) => emit(documentListeners, event),
    emitWindow: (event: string) => emit(windowListeners, event),
    setFocused: (nextFocused: boolean) => {
      hasFocus = nextFocused;
    },
    setVisibility: (nextVisibility: DocumentVisibilityState) => {
      document.visibilityState = nextVisibility;
    },
  };
}

function addListener(listeners: Map<string, Set<Listener>>, event: string, listener: Listener) {
  const eventListeners = listeners.get(event) ?? new Set<Listener>();
  eventListeners.add(listener);
  listeners.set(event, eventListeners);
}

function removeListener(listeners: Map<string, Set<Listener>>, event: string, listener: Listener) {
  listeners.get(event)?.delete(listener);
}

function emit(listeners: Map<string, Set<Listener>>, event: string) {
  for (const listener of listeners.get(event) ?? []) {
    if (typeof listener === 'function') {
      listener({} as Event);
    } else {
      listener.handleEvent({} as Event);
    }
  }
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function restoreGlobal(name: 'document' | 'window', descriptor?: PropertyDescriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, name);
  }
}
