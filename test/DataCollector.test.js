'use strict';

/**
 * Tests for DataCollector — normalizes mysql2 query results into the tables map.
 *
 * The collector uses an mysql2/promise-style `conn.query(sql, params)` that
 * resolves to `[rows, fields]`. We stub that here so tests don't require a
 * running database.
 */

const DataCollector = require('../src/DataCollector');

/**
 * Build a stub connection. Pass a "rows provider" function that receives
 * (sql, params) and returns the rows to respond with.
 */
function makeConn(rowsProvider) {
    const calls = [];
    return {
        calls,
        query: jest.fn(async (sql, params = []) => {
            calls.push({ sql, params });
            const rows = await rowsProvider(sql, params);
            return [rows, /* fields */ []];
        }),
    };
}

describe('DataCollector', () => {
    // ------------------------------------------------------------------
    // collect()
    // ------------------------------------------------------------------
    describe('collect', () => {
        it('stores rows keyed by "db.table"', async () => {
            const conn = makeConn(() => [
                { account_id: 1, email: 'a@b.com' },
                { account_id: 2, email: 'c@d.com' },
            ]);
            const collector = new DataCollector(conn);
            await collector.collect('my', 'accounts', 'SELECT * FROM accounts', [], 50);

            const tables = collector.getTables();
            expect(tables).toHaveProperty('my.accounts');
            expect(tables['my.accounts'].rows).toHaveLength(2);
            expect(tables['my.accounts'].total).toBe(2);
            expect(tables['my.accounts'].columns).toEqual(['account_id', 'email']);
            expect(tables['my.accounts'].truncated).toBe(false);
        });

        it('returns without adding an entry when 0 rows', async () => {
            const conn = makeConn(() => []);
            const collector = new DataCollector(conn);
            await collector.collect('my', 'empty', 'SELECT * FROM empty');
            expect(collector.getTables()).not.toHaveProperty('my.empty');
        });

        it('truncates rows to the provided limit', async () => {
            const rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
            const conn = makeConn(() => rows);
            const collector = new DataCollector(conn);
            await collector.collect('my', 'big', 'SELECT * FROM big', [], 3);

            const entry = collector.getTables()['my.big'];
            expect(entry.rows).toHaveLength(3);
            expect(entry.total).toBe(10);
            expect(entry.truncated).toBe(true);
            expect(entry.rows[0].id).toBe(1);
            expect(entry.rows[2].id).toBe(3);
        });

        it('is not marked truncated when rows count equals limit', async () => {
            const rows = Array.from({ length: 3 }, (_, i) => ({ id: i }));
            const conn = makeConn(() => rows);
            const collector = new DataCollector(conn);
            await collector.collect('my', 'exact', 'SELECT * FROM exact', [], 3);
            expect(collector.getTables()['my.exact'].truncated).toBe(false);
        });

        it('passes bind parameters to conn.query', async () => {
            const conn = makeConn(() => [{ id: 1 }]);
            const collector = new DataCollector(conn);
            await collector.collect('my', 't', 'SELECT * FROM t WHERE id = ?', [42]);
            expect(conn.query).toHaveBeenCalledTimes(1);
            expect(conn.query).toHaveBeenCalledWith('SELECT * FROM t WHERE id = ?', [42]);
        });

        it('derives columns from the first kept row', async () => {
            const conn = makeConn(() => [
                { a: 1, b: 2, c: 3 },
                { a: 10, b: 20, c: 30 },
            ]);
            const collector = new DataCollector(conn);
            await collector.collect('my', 'cols', 'SELECT a, b, c FROM cols');
            expect(collector.getTables()['my.cols'].columns).toEqual(['a', 'b', 'c']);
        });

        it('propagates connection errors', async () => {
            const boom = new Error('connection dropped');
            const conn = { query: jest.fn().mockRejectedValue(boom) };
            const collector = new DataCollector(conn);
            await expect(collector.collect('my', 't', 'SELECT 1')).rejects.toThrow('connection dropped');
        });
    });

    // ------------------------------------------------------------------
    // addTable()
    // ------------------------------------------------------------------
    describe('addTable', () => {
        it('creates a table entry from provided rows', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 'v', [{ id: 1 }, { id: 2 }], ['id']);
            const entry = collector.getTables()['my.v'];
            expect(entry.rows).toHaveLength(2);
            expect(entry.total).toBe(2);
            expect(entry.columns).toEqual(['id']);
            expect(entry.truncated).toBe(false);
        });

        it('derives columns from first row when none provided', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 't', [{ foo: 1, bar: 2 }]);
            expect(collector.getTables()['my.t'].columns).toEqual(['foo', 'bar']);
        });

        it('uses an explicit total when given', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 'v', [{ id: 1 }], ['id'], 99);
            expect(collector.getTables()['my.v'].total).toBe(99);
        });

        it('overwrites an existing entry', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 't', [{ id: 1 }], ['id']);
            collector.addTable('my', 't', [{ id: 5 }, { id: 6 }], ['id']);
            expect(collector.getTables()['my.t'].rows).toHaveLength(2);
        });

        it('handles empty rows + no columns gracefully', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 'empty', [], null);
            expect(collector.getTables()['my.empty'].columns).toEqual([]);
            expect(collector.getTables()['my.empty'].rows).toEqual([]);
        });
    });

    // ------------------------------------------------------------------
    // appendRows()
    // ------------------------------------------------------------------
    describe('appendRows', () => {
        it('appends rows to an existing table and bumps total', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 't', [{ id: 1 }], ['id']);
            collector.appendRows('my', 't', [{ id: 2 }, { id: 3 }]);
            const entry = collector.getTables()['my.t'];
            expect(entry.rows).toHaveLength(3);
            expect(entry.total).toBe(3);
        });

        it('creates a new table when missing', () => {
            const collector = new DataCollector(null);
            collector.appendRows('my', 'brand_new', [{ x: 1, y: 2 }]);
            const entry = collector.getTables()['my.brand_new'];
            expect(entry.rows).toHaveLength(1);
            expect(entry.columns).toEqual(['x', 'y']);
        });

        it('is a no-op for an empty append to existing', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 't', [{ id: 1 }], ['id']);
            collector.appendRows('my', 't', []);
            expect(collector.getTables()['my.t'].rows).toHaveLength(1);
        });
    });

    // ------------------------------------------------------------------
    // Accessors
    // ------------------------------------------------------------------
    describe('accessors', () => {
        it('has() returns true/false based on collected keys', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 'a', [{ id: 1 }], ['id']);
            expect(collector.has('my.a')).toBe(true);
            expect(collector.has('my.missing')).toBe(false);
        });

        it('getRows() returns the rows for a key', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 'a', [{ id: 1 }], ['id']);
            expect(collector.getRows('my.a')).toEqual([{ id: 1 }]);
        });

        it('getRows() returns [] for unknown keys', () => {
            const collector = new DataCollector(null);
            expect(collector.getRows('my.ghost')).toEqual([]);
        });

        it('getTotalRows() sums total across tables', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 'a', [{ id: 1 }], ['id'], 10);
            collector.addTable('my', 'b', [{ id: 2 }], ['id'], 25);
            expect(collector.getTotalRows()).toBe(35);
        });

        it('getTotalRows() is 0 when nothing is collected', () => {
            const collector = new DataCollector(null);
            expect(collector.getTotalRows()).toBe(0);
        });
    });
});
