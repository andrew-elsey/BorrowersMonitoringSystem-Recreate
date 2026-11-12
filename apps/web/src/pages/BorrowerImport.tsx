import { type BorrowerImportResult, CSV_IMPORT_HEADER, CSV_IMPORT_MAX_ROWS } from '@bms/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';
import { useNotify } from '../components/Notifications';

// MD-6: the Import CSV button and its result on the Borrowers screen (approved mockup). The
// server checks the file, the limits, and every row (CLAUDE.md rule 2); this only sends it.

export function useBorrowerImport(onImported: () => unknown) {
  const notify = useNotify();
  const inputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<{ fileName: string; counts: BorrowerImportResult }>();
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return apiFetch<BorrowerImportResult>('POST', '/borrowers/import', body);
    },
    onSuccess: (counts, file) => {
      setResult({ fileName: file.name, counts });
      return onImported();
    },
    onError: (error) => notify.error(error),
  });

  const button = (
    <>
      <button
        type="button"
        // aria-disabled, not disabled, so focus stays on the button while the upload runs.
        aria-disabled={upload.isPending || undefined}
        onClick={() => !upload.isPending && inputRef.current?.click()}
        className="h-11 cursor-pointer rounded-lg border border-primary bg-surface px-4 text-[15px] font-semibold text-primary hover:bg-primary-tint aria-disabled:cursor-wait"
      >
        {upload.isPending ? 'Importing…' : 'Import CSV'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        aria-label="CSV file to import"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared, so choosing the same file again (after fixing it) imports it again.
          event.target.value = '';
          if (file) upload.mutate(file);
        }}
      />
    </>
  );
  const panel = result && <ImportResult fileName={result.fileName} counts={result.counts} />;
  return { button, panel };
}

function ImportResult({ fileName, counts }: { fileName: string; counts: BorrowerImportResult }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Focus moves to the result so the counts are read out after the upload.
  useEffect(() => headingRef.current?.focus(), [counts]);
  const pill = 'rounded-lg px-3.5 py-2 font-semibold';
  return (
    <section
      aria-labelledby="import-result"
      className="flex flex-col gap-3.5 rounded-xl border border-divider bg-surface p-5"
    >
      <h2
        id="import-result"
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-bold wrap-anywhere outline-none"
      >
        Import result: {fileName}
      </h2>
      <div role="status" className="flex flex-wrap gap-3">
        <span className={`${pill} bg-primary-tint text-primary`}>{counts.created} created</span>
        <span className={`${pill} bg-primary-tint text-primary`}>{counts.updated} updated</span>
        {counts.unchanged > 0 && (
          <span className={`${pill} bg-page text-muted`}>{counts.unchanged} unchanged</span>
        )}
        <span className={`${pill} bg-danger-tint text-danger`}>
          {counts.rejected.length} rejected
        </span>
      </div>
      {counts.rejected.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-[15px]">
            <caption className="sr-only">Rejected rows</caption>
            <thead>
              <tr className="border-b border-divider">
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  Row
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  school_id
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  Reason
                </th>
              </tr>
            </thead>
            <tbody>
              {counts.rejected.map((reject) => (
                <tr key={reject.row} className="border-b border-divider align-top">
                  <td className="px-3 py-2.5">{reject.row}</td>
                  <td className="px-3 py-2.5 wrap-anywhere">{reject.schoolId}</td>
                  <td className="px-3 py-2.5">{reject.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-muted">
        CSV header: {CSV_IMPORT_HEADER.join(',')} · up to 2 MB and{' '}
        {CSV_IMPORT_MAX_ROWS.toLocaleString('en-US')} rows · rows are matched on school_id.
      </p>
    </section>
  );
}
