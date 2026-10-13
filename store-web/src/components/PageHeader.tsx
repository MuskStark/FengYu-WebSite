import type { ReactNode } from 'react';

/**
 * Shared page header: h1 + optional subtitle on the left, page-level actions on
 * the right. Every top-level view opens with this so titles, spacing and action
 * alignment stay identical across the store.
 */
export default function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="mt-1.5 max-w-3xl text-sm text-muted">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
