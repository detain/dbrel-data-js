'use strict';

/**
 * Tests for RelationshipMatcher — computes active relationships from collected rows.
 */

const RelationshipMatcher = require('../src/RelationshipMatcher');

describe('RelationshipMatcher', () => {
    let matcher;

    beforeEach(() => {
        matcher = new RelationshipMatcher();
    });

    // ------------------------------------------------------------------
    // Direct relationships
    // ------------------------------------------------------------------
    describe('direct relationships', () => {
        it('matches exact ids across tables', () => {
            const tables = {
                'my.vps': {
                    rows: [
                        { vps_id: 1, vps_custid: 100 },
                        { vps_id: 2, vps_custid: 100 },
                        { vps_id: 3, vps_custid: 200 },
                    ],
                    columns: ['vps_id', 'vps_custid'],
                    total: 3,
                },
                'my.accounts': {
                    rows: [
                        { account_id: 100, email: 'a@b.com' },
                        { account_id: 200, email: 'c@d.com' },
                    ],
                    columns: ['account_id', 'email'],
                    total: 2,
                },
            };
            const rules = [{
                source_db: 'my', source_table: 'vps', source_field: 'vps_custid',
                target_db: 'my', target_table: 'accounts', target_field: 'account_id',
                type: 'direct', cardinality: 'N:1', label: 'vps-to-account',
            }];

            const out = matcher.compute(tables, rules);
            expect(out).toHaveLength(1);
            const rel = out[0];
            expect(rel.source).toBe('my.vps');
            expect(rel.target).toBe('my.accounts');
            expect(rel.matches).toEqual([
                [0, [0]],
                [1, [0]],
                [2, [1]],
            ]);
        });

        it('coerces mixed numeric/string ids for comparison', () => {
            const tables = {
                'my.a': { rows: [{ x: 42 }, { x: '42' }], columns: ['x'], total: 2 },
                'my.b': { rows: [{ y: '42' }], columns: ['y'], total: 1 },
            };
            const rules = [{
                source_db: 'my', source_table: 'a', source_field: 'x',
                target_db: 'my', target_table: 'b', target_field: 'y',
                type: 'direct', cardinality: '1:1', label: '',
            }];
            const out = matcher.compute(tables, rules);
            expect(out[0].matches).toHaveLength(2);
        });

        it('skips null/empty/"0"/0 source values', () => {
            const tables = {
                'my.a': {
                    rows: [{ x: null }, { x: '' }, { x: '0' }, { x: 0 }, { x: undefined }, { x: 5 }],
                    columns: ['x'], total: 6,
                },
                'my.b': { rows: [{ y: 5 }], columns: ['y'], total: 1 },
            };
            const rules = [{
                source_db: 'my', source_table: 'a', source_field: 'x',
                target_db: 'my', target_table: 'b', target_field: 'y',
                type: 'direct', cardinality: '1:1', label: '',
            }];
            const out = matcher.compute(tables, rules);
            expect(out[0].matches).toEqual([[5, [0]]]);
        });

        it('omits the relationship entry when no rows match', () => {
            const tables = {
                'my.a': { rows: [{ x: 1 }], columns: ['x'], total: 1 },
                'my.b': { rows: [{ y: 2 }], columns: ['y'], total: 1 },
            };
            const rules = [{
                source_db: 'my', source_table: 'a', source_field: 'x',
                target_db: 'my', target_table: 'b', target_field: 'y',
                type: 'direct', cardinality: '1:1', label: '',
            }];
            expect(matcher.compute(tables, rules)).toEqual([]);
        });

        it('silently skips rules when source table not collected', () => {
            const tables = { 'my.b': { rows: [{ y: 1 }], columns: ['y'], total: 1 } };
            const rules = [{
                source_db: 'my', source_table: 'a', source_field: 'x',
                target_db: 'my', target_table: 'b', target_field: 'y',
                type: 'direct', cardinality: '1:1', label: '',
            }];
            expect(matcher.compute(tables, rules)).toEqual([]);
        });

        it('silently skips rules when target table not collected', () => {
            const tables = { 'my.a': { rows: [{ x: 1 }], columns: ['x'], total: 1 } };
            const rules = [{
                source_db: 'my', source_table: 'a', source_field: 'x',
                target_db: 'my', target_table: 'b', target_field: 'y',
                type: 'direct', cardinality: '1:1', label: '',
            }];
            expect(matcher.compute(tables, rules)).toEqual([]);
        });
    });

    // ------------------------------------------------------------------
    // find_in_set
    // ------------------------------------------------------------------
    describe('find_in_set relationships', () => {
        it('expands CSV ids to multiple target rows', () => {
            const tables = {
                'my.servers': {
                    rows: [{ server_id: 1, server_tags: '10,20,30' }],
                    columns: ['server_id', 'server_tags'],
                    total: 1,
                },
                'my.tags': {
                    rows: [{ tag_id: 10 }, { tag_id: 20 }, { tag_id: 30 }, { tag_id: 99 }],
                    columns: ['tag_id'], total: 4,
                },
            };
            const rules = [{
                source_db: 'my', source_table: 'servers', source_field: 'server_tags',
                target_db: 'my', target_table: 'tags', target_field: 'tag_id',
                type: 'find_in_set', cardinality: 'N:M', label: '',
            }];
            const out = matcher.compute(tables, rules);
            expect(out).toHaveLength(1);
            expect(out[0].type).toBe('find_in_set');
            expect(out[0].matches).toEqual([[0, [0, 1, 2]]]);
        });

        it('trims whitespace around CSV values', () => {
            const tables = {
                'my.s': { rows: [{ tags: ' 10 , 20 ' }], columns: ['tags'], total: 1 },
                'my.t': { rows: [{ id: 10 }, { id: 20 }], columns: ['id'], total: 2 },
            };
            const rules = [{
                source_db: 'my', source_table: 's', source_field: 'tags',
                target_db: 'my', target_table: 't', target_field: 'id',
                type: 'find_in_set', cardinality: 'N:M', label: '',
            }];
            const out = matcher.compute(tables, rules);
            expect(out[0].matches).toEqual([[0, [0, 1]]]);
        });

        it('skips rows with empty/null CSV source', () => {
            const tables = {
                'my.s': {
                    rows: [{ tags: null }, { tags: '' }, { tags: undefined }, { tags: '10' }],
                    columns: ['tags'], total: 4,
                },
                'my.t': { rows: [{ id: 10 }], columns: ['id'], total: 1 },
            };
            const rules = [{
                source_db: 'my', source_table: 's', source_field: 'tags',
                target_db: 'my', target_table: 't', target_field: 'id',
                type: 'find_in_set', cardinality: 'N:M', label: '',
            }];
            const out = matcher.compute(tables, rules);
            expect(out[0].matches).toEqual([[3, [0]]]);
        });

        it('omits the relationship entry when no matches', () => {
            const tables = {
                'my.s': { rows: [{ tags: '1,2' }], columns: ['tags'], total: 1 },
                'my.t': { rows: [{ id: 99 }], columns: ['id'], total: 1 },
            };
            const rules = [{
                source_db: 'my', source_table: 's', source_field: 'tags',
                target_db: 'my', target_table: 't', target_field: 'id',
                type: 'find_in_set', cardinality: 'N:M', label: '',
            }];
            expect(matcher.compute(tables, rules)).toEqual([]);
        });
    });

    // ------------------------------------------------------------------
    // cross_db (uses direct path internally)
    // ------------------------------------------------------------------
    describe('cross_db relationships', () => {
        it('matches rows across different logical databases', () => {
            const tables = {
                'my.accounts': {
                    rows: [{ account_id: 1, account_email: 'test@example.com' }],
                    columns: ['account_id', 'account_email'], total: 1,
                },
                'kayako_v4.swusers': {
                    rows: [
                        { userid: 5, email: 'test@example.com' },
                        { userid: 6, email: 'other@example.com' },
                    ],
                    columns: ['userid', 'email'], total: 2,
                },
            };
            const rules = [{
                source_db: 'my', source_table: 'accounts', source_field: 'account_email',
                target_db: 'kayako_v4', target_table: 'swusers', target_field: 'email',
                type: 'cross_db', cardinality: '1:N', label: 'Kayako link',
            }];
            const out = matcher.compute(tables, rules);
            expect(out).toHaveLength(1);
            expect(out[0].type).toBe('cross_db');
            expect(out[0].target).toBe('kayako_v4.swusers');
            expect(out[0].matches).toEqual([[0, [0]]]);
        });
    });

    // ------------------------------------------------------------------
    // Output structure
    // ------------------------------------------------------------------
    describe('output', () => {
        it('exposes all expected keys on each relationship entry', () => {
            const tables = {
                'my.a': { rows: [{ x: 1 }], columns: ['x'], total: 1 },
                'my.b': { rows: [{ y: 1 }], columns: ['y'], total: 1 },
            };
            const rules = [{
                source_db: 'my', source_table: 'a', source_field: 'x',
                target_db: 'my', target_table: 'b', target_field: 'y',
                type: 'direct', cardinality: '1:1', label: 'my-label',
            }];
            const out = matcher.compute(tables, rules);
            expect(out[0]).toMatchObject({
                source: 'my.a',
                source_field: 'x',
                target: 'my.b',
                target_field: 'y',
                type: 'direct',
                cardinality: '1:1',
                label: 'my-label',
            });
            expect(Array.isArray(out[0].matches)).toBe(true);
        });

        it('returns [] when rules array is empty', () => {
            expect(matcher.compute({ 'my.a': { rows: [{ x: 1 }], columns: ['x'], total: 1 } }, [])).toEqual([]);
        });

        it('returns [] when tables object is empty', () => {
            const rules = [{
                source_db: 'my', source_table: 'a', source_field: 'x',
                target_db: 'my', target_table: 'b', target_field: 'y',
                type: 'direct', cardinality: '1:1', label: '',
            }];
            expect(matcher.compute({}, rules)).toEqual([]);
        });
    });
});
