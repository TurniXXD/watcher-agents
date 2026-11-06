import React from 'react';

type FilterValue =
  string | number | boolean | null | FilterTree | FilterValue[];
type FilterTree = { [key: string]: FilterValue };

/** A list-view shortcut. The value `$now` is replaced at render time. */
export type QuickFilter = { label: string; where: FilterTree };

type Props = { collection: string; filters: QuickFilter[] };

const encodeWhere = (tree: FilterTree, now: string): string => {
  const params = new URLSearchParams();
  const visit = (value: FilterValue, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
    } else if (value !== null && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value))
        visit(entry, `${path}[${key}]`);
    } else {
      params.append(path, value === '$now' ? now : String(value));
    }
  };
  visit(tree, 'where');
  return params.toString();
};

/** One-click editorial filters rendered above native Payload list views. */
export const QuickFilters = ({ collection, filters }: Props) => {
  const now = new Date().toISOString();
  return (
    <nav aria-label="Quick filters" className="vch-quick-filters">
      <a href={`/admin/collections/${collection}`}>All</a>
      {filters.map((filter) => (
        <a
          href={`/admin/collections/${collection}?${encodeWhere(filter.where, now)}`}
          key={filter.label}
        >
          {filter.label}
        </a>
      ))}
    </nav>
  );
};
