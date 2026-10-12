'use strict';

interface Column<T> {
  title: string;
  value: (row: T) => number | string | undefined;
  text: (row: T) => string;
  numeric?: boolean;
}

interface SortState {
  key: number;
  dir: 1 | -1;
}

function renderTable<T>(rows: T[], columns: Column<T>[], sort: SortState, onSort: () => void, flag?: (row: T) => string): HTMLElement {
  const sorted = sortBy(rows, columns[sort.key].value, sort.dir);
  const head = columns.map((c, i) => {
    const arrow = i === sort.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
    const button = h('button', { type: 'button', class: 'sort' }, c.title + arrow);
    button.addEventListener('click', () => {
      if (sort.key === i) sort.dir = sort.dir === 1 ? -1 : 1;
      else {
        sort.key = i;
        sort.dir = c.numeric ? -1 : 1;
      }
      onSort();
    });
    return h('th', { class: c.numeric ? 'num' : null, 'aria-sort': i === sort.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none' }, button);
  });
  const body = sorted.map((r) => h('tr', { class: flag ? flag(r) : null }, ...columns.map((c) => h('td', { class: c.numeric ? 'num' : null }, c.text(r)))));
  return h('table', null, h('thead', null, h('tr', null, ...head)), h('tbody', null, ...body));
}
