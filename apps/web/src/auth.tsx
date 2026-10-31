import type { Role } from '@bms/shared';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createContext, use, type ReactNode } from 'react';
import { apiFetch, ApiRequestError } from './api';
import { Alert } from './components/Alert';

// The same shape the API returns from login and GET /api/auth/me.
export type SignedInUser = { id: string; name: string; username: string; role: Role };

const ME_KEY = ['me'];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  HANDLER: 'Handler',
  VIEWER: 'View-only',
};

// A 401 from any request means the session is gone, so the user goes back to the login page:
// clearing the signed-in user makes the route guard redirect (AUTH-4).
export function createQueryClient(): QueryClient {
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: signOutOn401 }),
    mutationCache: new MutationCache({ onError: signOutOn401 }),
    defaultOptions: { queries: { retry: false } },
  });
  function signOutOn401(error: Error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      queryClient.setQueryData(ME_KEY, null);
    }
  }
  return queryClient;
}

async function fetchSignedInUser(): Promise<SignedInUser | null> {
  try {
    return (await apiFetch<{ user: SignedInUser }>('GET', '/auth/me')).user;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}

type AuthValue = {
  user: SignedInUser | null;
  signIn: (user: SignedInUser) => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

// Loads the signed-in user once, so a page reload keeps the user signed in.
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchSignedInUser, staleTime: Infinity });

  if (me.isPending) return <p className="p-6 text-muted">Loading…</p>;
  if (me.isError) {
    return (
      <main className="p-6">
        <Alert kind="error">Could not reach the server. Reload the page to try again.</Alert>
      </main>
    );
  }

  const value: AuthValue = {
    user: me.data,
    signIn: (user) => queryClient.setQueryData(ME_KEY, user),
    signOut: async () => {
      await apiFetch('POST', '/auth/logout');
      // Drop everything cached for this user before the next person uses the counter PC.
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY[0] });
      queryClient.setQueryData(ME_KEY, null);
    },
  };
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthValue {
  const value = use(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
