import { describe, expect, it } from 'vitest';
import {
  deleteTableColumn,
  deleteTableDataRow,
  insertTableColumn,
  insertTableDataRow,
  setTableColumnAlignment,
  tableToMarkdown,
  type TableAlignment,
} from '../widgets';

function mkRows(rows: string[][]): string[][] {
  return rows.map((row) => [...row]);
}

describe('table widget serialization', () => {
  it('serializes header alignment markers correctly', () => {
    const rows = mkRows([
      ['name', 'score', 'remark'],
      ['---', '---', '---'],
      ['alice', '90', 'ok'],
    ]);
    const alignments: TableAlignment[] = ['left', 'center', 'right'];

    const markdown = tableToMarkdown(rows, alignments, true);

    expect(markdown).toBe(
      '| name | score | remark |\n| :--- | :---: | ---: |\n| alice | 90 | ok |'
    );
  });

  it('supports insert/delete column and keeps markdown structure valid', () => {
    const baseRows = mkRows([
      ['h1', 'h2'],
      ['---', '---'],
      ['r1c1', 'r1c2'],
    ]);
    const baseAlignments: TableAlignment[] = [null, null];

    const inserted = insertTableColumn(baseRows, baseAlignments, true, 0, 'right');
    expect(inserted.rows[0].length).toBe(3);
    expect(inserted.alignments.length).toBe(3);

    const deleted = deleteTableColumn(inserted.rows, inserted.alignments, true, 1);
    const markdown = tableToMarkdown(deleted.rows, deleted.alignments, true);

    expect(markdown).toBe('| h1 | h2 |\n| --- | --- |\n| r1c1 | r1c2 |');
  });

  it('protects deleting the last column', () => {
    const rows = mkRows([
      ['h1'],
      ['---'],
      ['r1'],
    ]);
    const alignments: TableAlignment[] = [null];

    const next = deleteTableColumn(rows, alignments, true, 0);

    expect(next.rows[0].length).toBe(1);
    expect(next.rows[2].length).toBe(1);
    expect(tableToMarkdown(next.rows, next.alignments, true)).toBe('| h1 |\n| --- |\n| r1 |');
  });

  it('supports insert/delete data row and protects last data row', () => {
    const rows = mkRows([
      ['h1', 'h2'],
      ['---', '---'],
      ['a1', 'a2'],
    ]);
    const alignments: TableAlignment[] = [null, null];

    const withExtra = insertTableDataRow(rows, alignments, true, 2, 'below');
    expect(withExtra.rows.length).toBe(4);

    const deletedOnce = deleteTableDataRow(withExtra.rows, withExtra.alignments, true, 3);
    expect(deletedOnce.rows.length).toBe(3);

    const protectedDelete = deleteTableDataRow(deletedOnce.rows, deletedOnce.alignments, true, 2);
    expect(protectedDelete.rows.length).toBe(3);
  });

  it('updates separator line when switching alignment', () => {
    const rows = mkRows([
      ['c1', 'c2'],
      ['---', '---'],
      ['v1', 'v2'],
    ]);
    const alignments: TableAlignment[] = [null, null];

    const centered = setTableColumnAlignment(rows, alignments, true, 0, 'center');
    const right = setTableColumnAlignment(centered.rows, centered.alignments, true, 1, 'right');

    expect(tableToMarkdown(right.rows, right.alignments, true)).toBe(
      '| c1 | c2 |\n| :---: | ---: |\n| v1 | v2 |'
    );
  });
});
