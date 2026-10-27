import { useEffect, useRef, type ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  ArrowUpRight,
  FileSpreadsheet,
} from 'lucide-react';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
export function Badge({ value }: { value: string }) {
  const labels: Record<string, string> = {
    create: 'New product',
    update: 'Update',
    unchanged: 'Unchanged',
    blocked: 'Blocked',
    excluded: 'Excluded',
    parsing: 'Processing',
    mapping: 'Needs mapping',
    preparing: 'Validating',
    review: 'Ready to review',
    committing: 'Committing',
    completed: 'Completed',
    failed: 'Needs attention',
  };
  return (
    <span className={`badge ${value}`}>
      <span className="status-dot" />
      {labels[value] ?? value}
    </span>
  );
}
export function ErrorBox({ error }: { error: unknown }) {
  return error ? (
    <div className="alert error" role="alert">
      <AlertCircle size={17} />
      <span>{error instanceof Error ? error.message : String(error)}</span>
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      Loading workspace…
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <FileSpreadsheet size={32} />
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}
export function Table<T>({ data, columns }: { data: T[]; columns: ColumnDef<T, any>[] }) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Data table">
      <table>
        <thead>
          {table.getHeaderGroups().map((g) => (
            <tr key={g.id}>
              {g.headers.map((h) => (
                <th key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => (
            <tr key={r.id}>
              {r.getVisibleCells().map((c) => (
                <td key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Pagination({
  page,
  total,
  setPage,
}: {
  page: number;
  total: number;
  setPage: (n: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {total
          ? `${(page - 1) * 25 + 1}–${Math.min(page * 25, total)} of ${total} records`
          : '0 records'}
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="Previous page"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          Page {page} of {Math.max(1, Math.ceil(total / 25))}
        </span>
        <button
          className="icon-button"
          aria-label="Next page"
          disabled={page * 25 >= total}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose}>
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{actions}</div>
    </div>
  );
}
export function ExternalMark() {
  return <ArrowUpRight size={16} />;
}
export const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
export const money = (value: string, currency: string) =>
  `${currency} ${value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
