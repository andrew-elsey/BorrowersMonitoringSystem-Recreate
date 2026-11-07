import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
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
const MessageAreaContext = createContext<HTMLDivElement | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(0);
  const area = useRef<HTMLDivElement>(null);
  // The same element as state, so pages re-render with it and can portal into it.
  const [areaElement, setAreaElement] = useState<HTMLDivElement | null>(null);
  const setArea = useCallback((element: HTMLDivElement | null) => {
    area.current = element;
    setAreaElement(element);
  }, []);

  // When the browser scrolls a focused field into view, it keeps it below the pinned messages,
  // so they never cover the field being used. It watches the area's contents rather than
  // `notices`, because pages also put their own messages here (useMessageArea).
  useLayoutEffect(() => {
    const element = area.current!;
    const update = () => {
      const height = element.childElementCount ? element.offsetHeight : 0;
      document.documentElement.style.scrollPaddingTop = `${height}px`;
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    // Cleared on unmount too, so sign-out never leaves the padding on the sign-in page.
    return () => {
      observer.disconnect();
      document.documentElement.style.scrollPaddingTop = '';
    };
  }, []);

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
      {/* Above the page content, as in the approved mockup. Sticky: on a long page it stays at */}
      {/* the top of the window, so a result is never scrolled out of sight (BRW-3). It sits in */}
      {/* <main>, below the top bar. Always rendered, so screen readers announce messages added */}
      {/* to it. empty:-mb-5 cancels the gap of AppShell's <main> while there is no message. */}
      <div
        ref={setArea}
        aria-live="polite"
        className="sticky top-0 z-10 flex flex-col gap-2 bg-page py-2 empty:-mb-5 empty:py-0"
      >
        {notices.map((notice) => (
          <Alert key={notice.id} kind={notice.kind} onDismiss={() => dismiss(notice.id)}>
            {notice.text}
          </Alert>
        ))}
      </div>
      <MessageAreaContext.Provider value={areaElement}>{children}</MessageAreaContext.Provider>
    </NotifyContext.Provider>
  );
}

// The pinned message area itself, for a page message that needs more than text (a button, say)
// and must stay in sight like the others: createPortal(<Alert>…</Alert>, area). Null until mounted.
export function useMessageArea(): HTMLDivElement | null {
  return useContext(MessageAreaContext);
}

export function useNotify(): Notify {
  const notify = useContext(NotifyContext);
  if (!notify) throw new Error('useNotify needs a NotificationProvider above it');
  return notify;
}
