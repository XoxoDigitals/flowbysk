'use client';

type Props = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
};

export function AdminTablePager({ page, pageSize, total, onPageChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(total, safePage * pageSize);

  if (total <= pageSize) {
    return (
      <p className="px-1 pt-2 text-[11px] text-[var(--ink3)]">
        Showing {total} of {total}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-3">
      <p className="text-[11px] text-[var(--ink3)]">
        Showing {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-secondary !px-3 !py-1.5 !text-xs"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
        >
          Previous
        </button>
        <span className="font-mono text-[11px] text-[var(--ink3)]">
          {safePage} / {totalPages}
        </span>
        <button
          type="button"
          className="btn-secondary !px-3 !py-1.5 !text-xs"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
