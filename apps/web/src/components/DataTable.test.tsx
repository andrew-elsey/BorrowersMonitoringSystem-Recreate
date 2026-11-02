import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { DataTable, type Column } from './DataTable';

afterEach(cleanup);

type Room = { id: string; name: string };
const columns: Column<Room>[] = [
  { header: 'Name', cell: (room) => room.name },
  { header: 'Code', cell: (room) => room.id.toUpperCase() },
];
const rooms: Room[] = [
  { id: 'cl-201', name: 'Computer Lab 201' },
  { id: 'avr-1', name: 'Audio-Visual Room 1' },
];

function renderTable(props: Partial<Parameters<typeof DataTable<Room>>[0]> = {}) {
  const onPageChange = vi.fn();
  render(
    <DataTable
      caption="Rooms and labs"
      columns={columns}
      rows={rooms}
      rowKey={(room) => room.id}
      isLoading={false}
      emptyText="No rooms yet."
      page={1}
      pageSize={25}
      total={2}
      onPageChange={onPageChange}
      {...props}
    />,
  );
  return onPageChange;
}

test('shows one row per record under labeled column headers', () => {
  renderTable();
  const table = screen.getByRole('table', { name: 'Rooms and labs' });
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent),
  ).toEqual(['Name', 'Code']);
  expect(within(table).getByRole('row', { name: 'Computer Lab 201 CL-201' })).toBeTruthy();
  expect(screen.getByText('Showing 1–2 of 2')).toBeTruthy();
  // One page only, so there is nothing to page through.
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
});

test('shows a loading state and marks the table busy (TC-FND-24)', () => {
  renderTable({ rows: undefined, isLoading: true });
  expect(screen.getByText('Loading…')).toBeTruthy();
  expect(screen.getByRole('table').getAttribute('aria-busy')).toBe('true');
});

test('shows the empty state when there are no rows (TC-FND-24)', () => {
  renderTable({ rows: [], total: 0 });
  expect(screen.getByText('No rooms yet.')).toBeTruthy();
  expect(screen.queryByText(/Showing/)).toBeNull();
});

test('pages forward and back, with the buttons disabled at each end (TC-FND-24)', async () => {
  const user = userEvent.setup();
  const onPageChange = renderTable({ page: 1, pageSize: 25, total: 60 });

  expect(screen.getByText('Showing 1–25 of 60')).toBeTruthy();
  expect(screen.getByText('Page 1 of 3')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(onPageChange).toHaveBeenCalledWith(2);

  cleanup();
  const onLastPage = renderTable({ page: 3, pageSize: 25, total: 60 });
  expect(screen.getByText('Showing 51–60 of 60')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Previous' }));
  expect(onLastPage).toHaveBeenCalledWith(2);
});

test('a page past the end (after deleting its last row) moves to the new last page', () => {
  const onPageChange = renderTable({ rows: [], page: 3, pageSize: 25, total: 50 });
  expect(onPageChange).toHaveBeenCalledWith(2);
});

test('the page buttons work from the keyboard (TC-FND-23)', async () => {
  const user = userEvent.setup();
  const onPageChange = renderTable({ page: 2, pageSize: 25, total: 60 });

  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Previous' }));
  await user.keyboard('{Enter}');
  expect(onPageChange).toHaveBeenCalledWith(1);
});

test('hides the row count while loading, and focuses the table after a page change', async () => {
  const user = userEvent.setup();
  renderTable({ rows: undefined, isLoading: true, total: 0 });
  expect(screen.queryByText(/Showing/)).toBeNull();
  cleanup();

  // On page 1 Previous is disabled, so focus must not stay on it (it would drop to the page start).
  renderTable({ page: 2, pageSize: 25, total: 30 });
  await user.click(screen.getByRole('button', { name: 'Previous' }));
  expect(document.activeElement).toBe(screen.getByRole('table', { name: 'Rooms and labs' }));
});
