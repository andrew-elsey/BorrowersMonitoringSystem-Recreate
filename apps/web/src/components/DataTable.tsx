import type { ReactNode } from 'react';

// A paginated table for list screens. The page passes one page of rows from a list endpoint
// ({ data, page, pageSize, total }, ARCHITECTURE.md 7) and loads another page on onPageChange.

export type Column<T> = { header: string; cell: (row: T) => ReactNode };

type DataTableProps<T> = {
  caption: string; // read by screen readers to name the table
  columns: readonly Column<T>[];
  rows: readonly T[] | undefined;
  rowKey: (row: T) => string;
  isLoading: boolean;
  emptyText: string;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
};

export function DataTable<T>(props: DataTableProps<T>) {
  const { columns, rows, isLoading, page, pageSize, total } = props;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-xl border border-divider bg-surface">
        <table aria-busy={isLoading} className="w-full border-collapse text-left text-[15px]">
          <caption className="sr-only">{props.caption}</caption>
          <thead>
            <tr className="border-b border-divider bg-page">
              {columns.map((column) => (
                <th key={column.header} scope="col" className="px-4 py-3 font-semibold">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading || !rows || rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-muted">
                  {isLoading ? 'Loading…' : props.emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={props.rowKey(row)} className="border-b border-divider last:border-b-0">
                  {columns.map((column) => (
                    <td key={column.header} className="px-4 py-3">
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Showing {first}–{last} of {total}
        </p>
        {pageCount > 1 && (
          <div className="flex items-center gap-2">
            <PageButton
              label="Previous"
              disabled={isLoading || page <= 1}
              onClick={() => props.onPageChange(page - 1)}
            />
            <span className="text-sm">
              Page {page} of {pageCount}
            </span>
            <PageButton
              label="Next"
              disabled={isLoading || page >= pageCount}
              onClick={() => props.onPageChange(page + 1)}
            />
          </div>
        )}
      </nav>
    </div>
  );
}

function PageButton(props: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className="h-10 cursor-pointer rounded-lg border border-field-border bg-surface px-4 text-[15px] font-medium transition-colors duration-150 hover:bg-page disabled:cursor-not-allowed disabled:opacity-50"
    >
      {props.label}
    </button>
  );
}
