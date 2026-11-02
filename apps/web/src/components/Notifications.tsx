import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiRequestError, errorText } from '../api';
import { Alert } from './Alert';

// Success and error messages after an action, for example "Category saved." or the API's error
// message. Messages stay until dismissed, so nobody misses one while busy at the counter.
// AppShell mounts the provider inside <main>, so messages show at the top of every signed-in page.
// Usage: const notify = useNotify(); notify.success('Category saved.'); notify.error(error);

type Notify = { success: (text: string) => void; error: (error: unknown) => void };
type Notice = { id: number; kind: 'success' | 'error' | 'wait'; text: string };

const NotifyContext = createContext<Notify | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(0);

  const add = useCallback((kind: Notice['kind'], text: string) => {
    nextId.current += 1;
    const id = nextId.current;
    // Only the newest three, so unread messages never cover the screen.
    setNotices((current) => [...current, { id, kind, text }].slice(-3));
  }, []);

  const notify = useMemo<Notify>(
    () => ({
      success: (text) => add('success', text),
      // The API error message, or "Try again in N seconds" on 429 and 503 (errorText, AUTH-4).
      error: (error) => {
        const isWait = error instanceof ApiRequestError && error.retryAfterSeconds !== null;
        add(isWait ? 'wait' : 'error', errorText(error));
      },
    }),
    [add],
  );

  const dismiss = (id: number) => setNotices((current) => current.filter((n) => n.id !== id));

  return (
    <NotifyContext.Provider value={notify}>
      {/* In the page flow above the page content, as in the approved mockup, so a message never */}
      {/* covers a button. Always rendered, so screen readers announce messages added to it. */}
      {/* empty:-mb-5 cancels the gap of AppShell's <main> while there is no message. */}
      <div aria-live="polite" className="flex flex-col gap-2 empty:-mb-5">
        {notices.map((notice) => (
          <Alert key={notice.id} kind={notice.kind} onDismiss={() => dismiss(notice.id)}>
            {notice.text}
          </Alert>
        ))}
      </div>
      {children}
    </NotifyContext.Provider>
  );
}

export function useNotify(): Notify {
  const notify = useContext(NotifyContext);
  if (!notify) throw new Error('useNotify needs a NotificationProvider above it');
  return notify;
}
