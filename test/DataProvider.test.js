'use strict';

/**
 * Integration tests for DataProvider — combines schema, collector, and matcher
 * to produce the full visualization payload.
 */

const path = require('path');
const RelationshipSchema = require('../src/RelationshipSchema');
const RelationshipMatcher = require('../src/RelationshipMatcher');
const DataCollector = require('../src/DataCollector');
const DataProvider = require('../src/DataProvider');

const fixturePath = path.join(__dirname, 'fixtures', 'sample_schema.json');

describe('DataProvider', () => {
    let schema;

    beforeEach(() => {
        schema = new RelationshipSchema(fixturePath);
    });

    // ------------------------------------------------------------------
    // build() output shape
    // ------------------------------------------------------------------
    describe('build output', () => {
        it('has all expected top-level keys', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 'accounts', [{ account_id: 1 }], ['account_id']);
            const provider = new DataProvider(schema);
            const out = provider.build(collector, { custid: 1 });
            for (const k of ['custid', 'tables', 'relationships', 'metadata', 'prefixes', 'primaryKeys', 'hiddenFields']) {
                expect(out).toHaveProperty(k);
            }
        });

        it('passes through options to output', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 'accounts', [{ account_id: 42 }], ['account_id']);
            const provider = new DataProvider(schema);
            const primaryKeys = { accounts: 'account_id', vps: 'vps_id' };
            const prefixes = { accounts: 'account_', vps: 'vps_' };
            const hiddenFields = ['password'];

            const out = provider.build(collector, {
                custid: 42, primaryKeys, prefixes, hiddenFields,
            });

            expect(out.custid).toBe(42);
            expect(out.primaryKeys).toBe(primaryKeys);
            expect(out.prefixes).toBe(prefixes);
            expect(out.hiddenFields).toBe(hiddenFields);
        });

        it('applies defaults when options are omitted', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 'accounts', [{ account_id: 1 }], ['account_id']);
            const provider = new DataProvider(schema);
            const out = provider.build(collector);

            expect(out.custid).toBe(0);
            expect(out.primaryKeys).toEqual({});
            expect(out.prefixes).toEqual({});
            expect(out.hiddenFields).toEqual([]);
            expect(out.metadata.pivot_table).toBeNull();
            expect(out.metadata.pivot_id).toBeNull();
        });

        it('metadata counts tables, rows, and relationships', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 'accounts', [{ account_id: 10 }], ['account_id'], 1);
            collector.addTable('my', 'vps',
                [{ vps_id: 1, vps_custid: 10 }, { vps_id: 2, vps_custid: 10 }],
                ['vps_id', 'vps_custid'], 2);

            const provider = new DataProvider(schema);
            const out = provider.build(collector, { custid: 10 });

            expect(out.metadata.table_count).toBe(2);
            expect(out.metadata.total_rows).toBe(3);
            expect(out.metadata.relationship_count).toBeGreaterThanOrEqual(1);
            expect(typeof out.metadata.query_time_ms).toBe('number');
        });

        it('produces matched relationships from the schema rules', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 'accounts', [{ account_id: 10 }], ['account_id']);
            collector.addTable('my', 'vps', [{ vps_id: 1, vps_custid: 10 }], ['vps_id', 'vps_custid']);

            const provider = new DataProvider(schema);
            const out = provider.build(collector, { custid: 10 });
            expect(out.relationships.length).toBeGreaterThan(0);
            const vpsRel = out.relationships.find((r) => r.source === 'my.vps' && r.target === 'my.accounts');
            expect(vpsRel).toBeDefined();
            expect(vpsRel.matches).toEqual([[0, [0]]]);
        });
    });

    // ------------------------------------------------------------------
    // Pivot filtering
    // ------------------------------------------------------------------
    describe('pivot filtering', () => {
        it('keeps connected tables within 2 hops and filters out others', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 'accounts', [{ account_id: 10 }], ['account_id']);
            collector.addTable('my', 'vps',
                [{ vps_id: 1, vps_custid: 10, vps_server: 5 }],
                ['vps_id', 'vps_custid', 'vps_server']);
            collector.addTable('my', 'servers', [{ server_id: 5 }], ['server_id']);
            collector.addTable('my', 'unrelated', [{ id: 1 }], ['id']);

            const provider = new DataProvider(schema);
            const out = provider.build(collector, {
                custid: 10, pivotTable: 'vps', pivotId: 1,
            });

            expect(out.tables).toHaveProperty('my.vps');
            expect(out.tables).toHaveProperty('my.accounts');    // always kept
            expect(out.tables).toHaveProperty('my.servers');     // direct via vps_server
            expect(out.tables).not.toHaveProperty('my.unrelated');
        });

        it('sets pivot_table and pivot_id in metadata', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 'vps', [{ vps_id: 1 }], ['vps_id']);
            const provider = new DataProvider(schema);
            const out = provider.build(collector, {
                custid: 10, pivotTable: 'vps', pivotId: 1,
            });
            expect(out.metadata.pivot_table).toBe('vps');
            expect(out.metadata.pivot_id).toBe(1);
        });

        it('is skipped when pivot table is not in collected tables', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 'accounts', [{ account_id: 10 }], ['account_id']);
            collector.addTable('my', 'other', [{ id: 1 }], ['id']);

            const provider = new DataProvider(schema);
            const out = provider.build(collector, {
                custid: 10, pivotTable: 'nonexistent', pivotId: 5,
            });
            expect(out.tables).toHaveProperty('my.accounts');
            expect(out.tables).toHaveProperty('my.other');
        });

        it('is skipped when pivotId is 0', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 'accounts', [{ account_id: 10 }], ['account_id']);
            collector.addTable('my', 'unrelated', [{ id: 1 }], ['id']);

            const provider = new DataProvider(schema);
            const out = provider.build(collector, {
                custid: 10, pivotTable: 'vps', pivotId: 0,
            });
            expect(Object.keys(out.tables)).toHaveLength(2);
        });

        it('always keeps my.accounts for context', () => {
            const collector = new DataCollector(null);
            collector.addTable('my', 'accounts', [{ account_id: 10 }], ['account_id']);
            collector.addTable('my', 'servers', [{ server_id: 5 }], ['server_id']);
            collector.addTable('my', 'isolated_pivot', [{ isolated_id: 1 }], ['isolated_id']);

            const provider = new DataProvider(schema);
            const out = provider.build(collector, {
                custid: 10, pivotTable: 'isolated_pivot', pivotId: 1,
            });
            expect(out.tables).toHaveProperty('my.accounts');
        });
    });

    // ------------------------------------------------------------------
    // Accessors & injection
    // ------------------------------------------------------------------
    describe('accessors', () => {
        it('getSchema returns the schema', () => {
            const provider = new DataProvider(schema);
            expect(provider.getSchema()).toBe(schema);
        });

        it('getMatcher returns a default matcher when none injected', () => {
            const provider = new DataProvider(schema);
            expect(provider.getMatcher()).toBeInstanceOf(RelationshipMatcher);
        });

        it('accepts a custom matcher via constructor', () => {
            const custom = new RelationshipMatcher();
            const provider = new DataProvider(schema, custom);
            expect(provider.getMatcher()).toBe(custom);
        });
    });

    // ------------------------------------------------------------------
    // Edge cases
    // ------------------------------------------------------------------
    describe('edge cases', () => {
        it('handles an empty collector', () => {
            const collector = new DataCollector(null);
            const provider = new DataProvider(schema);
            const out = provider.build(collector, { custid: 0 });
            expect(out.tables).toEqual({});
            expect(out.relationships).toEqual([]);
            expect(out.metadata.table_count).toBe(0);
            expect(out.metadata.total_rows).toBe(0);
        });

        it('populates databases from schema metadata', () => {
            const collector = new DataCollector(null);
            const provider = new DataProvider(schema);
            const out = provider.build(collector, { custid: 0 });
            expect(Array.isArray(out.metadata.databases)).toBe(true);
            expect(out.metadata.databases).toContain('my');
        });

        it('works end-to-end with a stubbed mysql2 connection', async () => {
            const rowsByTable = {
                'my.accounts': [{ account_id: 10, email: 'user@example.com' }],
                'my.vps': [{ vps_id: 1, vps_custid: 10, vps_server: 0 }],
            };
            const conn = {
                query: jest.fn(async (sql) => {
                    if (sql.includes('accounts')) return [rowsByTable['my.accounts'], []];
                    if (sql.includes('vps')) return [rowsByTable['my.vps'], []];
                    return [[], []];
                }),
            };

            const collector = new DataCollector(conn);
            await collector.collect('my', 'accounts', 'SELECT * FROM accounts WHERE account_id = ?', [10]);
            await collector.collect('my', 'vps', 'SELECT * FROM vps WHERE vps_custid = ?', [10]);

            const provider = new DataProvider(schema);
            const out = provider.build(collector, {
                custid: 10,
                primaryKeys: { accounts: 'account_id', vps: 'vps_id' },
                prefixes: { accounts: 'account_', vps: 'vps_' },
            });

            expect(out.custid).toBe(10);
            expect(out.tables['my.accounts'].rows).toHaveLength(1);
            expect(out.tables['my.vps'].rows).toHaveLength(1);
            const vpsRel = out.relationships.find((r) => r.source === 'my.vps');
            expect(vpsRel).toBeDefined();
        });
    });
});
