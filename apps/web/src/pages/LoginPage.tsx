import { loginSchema, type LoginInput } from '@bms/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation } from 'react-router';
import { apiFetch, ApiRequestError, errorText } from '../api';
import { useAuth, type SignedInUser } from '../auth';
import { Alert } from '../components/Alert';
import { Field } from '../components/Field';
import { BoxIcon } from '../components/icons';

export function LoginPage() {
  const { user, signIn } = useAuth();
  const location = useLocation();
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  });
  const login = useMutation({
    mutationFn: (input: LoginInput) =>
      apiFetch<{ user: SignedInUser }>('POST', '/auth/login', input),
    onSuccess: ({ user }) => signIn(user),
    onError: () => {
      form.resetField('password');
      form.setFocus('password');
    },
  });

  // Back to the page the user first asked for (set by RequireSignIn), or home.
  if (user)
    return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace />;

  const { errors } = form.formState;
  // 429 and 503 are "wait and retry", not "wrong password" (AUTH-4).
  const isWait = login.error instanceof ApiRequestError && login.error.retryAfterSeconds !== null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4 py-12">
      <div className="flex w-full max-w-[400px] flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-white">
            <BoxIcon size={26} />
          </div>
          <h1 className="text-2xl leading-tight font-bold">Borrowers Monitoring System</h1>
          <p className="text-muted">Staff sign-in</p>
        </div>

        <form
          noValidate
          onSubmit={form.handleSubmit((input) => login.mutate(input))}
          className="flex flex-col gap-5 rounded-xl border border-divider bg-surface p-7"
        >
          {login.isError && (
            <Alert kind={isWait ? 'wait' : 'error'}>{errorText(login.error)}</Alert>
          )}
          <Field
            id="username"
            label="Username"
            autoComplete="username"
            error={errors.username?.message}
            {...form.register('username')}
          />
          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            error={errors.password?.message}
            {...form.register('password')}
          />
          <button
            type="submit"
            disabled={login.isPending}
            className="h-11 cursor-pointer rounded-lg bg-primary text-base font-semibold text-white transition-colors duration-150 hover:bg-primary-hover disabled:cursor-wait disabled:opacity-80"
          >
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm leading-normal text-muted">
          Forgot your password? Ask an admin to reset it.
        </p>
      </div>
    </main>
  );
}
