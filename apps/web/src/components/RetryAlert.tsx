import type { UseQueryResult } from '@tanstack/react-query';
import { errorText } from '../api';
import { Alert } from './Alert';

// A failed load: the error and a Retry button, shown instead of a list so it does not look empty.
// The button is gone once the load works, so onRetried moves focus somewhere useful instead of the
// page start (SPEC 8).
export function RetryAlert({
  query,
  onRetried,
}: {
  query: Pick<UseQueryResult, 'error' | 'isFetching' | 'refetch'>;
  onRetried?: () => void;
}) {
  async function retry() {
    const result = await query.refetch();
    if (!result.isError) onRetried?.();
  }
  return (
    <Alert kind="error">
      {errorText(query.error)}{' '}
      <button
        type="button"
        disabled={query.isFetching}
        onClick={retry}
        className="cursor-pointer font-semibold underline underline-offset-4 disabled:cursor-wait"
      >
        Retry
      </button>
    </Alert>
  );
}
