'use strict';

/**
 * Tests for RelationshipSchema — loads and normalizes the relationship schema JSON.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const RelationshipSchema = require('../src/RelationshipSchema');

const fixturePath = path.join(__dirname, 'fixtures', 'sample_schema.json');

describe('RelationshipSchema', () => {
    // ------------------------------------------------------------------
    // Construction
    // ------------------------------------------------------------------
    describe('constructor', () => {
        it('loads from a file path', () => {
            const schema = new RelationshipSchema(fixturePath);
            expect(schema.getRaw()).toBeTruthy();
            expect(Array.isArray(schema.getRules())).toBe(true);
        });

        it('accepts a pre-parsed object and skips filesystem access', () => {
            const obj = { relationships: [] };
            const schema = new RelationshipSchema(obj);
            expect(schema.getRaw()).toBe(obj);
        });

        it('throws when the file path does not exist', () => {
            const missing = path.join(os.tmpdir(), 'not_a_real_schema_' + Date.now() + '.json');
            expect(() => new RelationshipSchema(missing))
                .toThrow(/Schema file not found/);
        });

        it('throws when the input is neither a string nor an object', () => {
            expect(() => new RelationshipSchema(12345)).toThrow(/Expected string path or object/);
        });

        it('throws when the JSON is invalid', () => {
            const tmp = path.join(os.tmpdir(), 'bad_schema_' + Date.now() + '.json');
            fs.writeFileSync(tmp, '{ not valid json ');
            try {
                expect(() => new RelationshipSchema(tmp)).toThrow();
            } finally {
                fs.unlinkSync(tmp);
            }
        });
    });

    // ------------------------------------------------------------------
    // Rule normalization
    // ------------------------------------------------------------------
    describe('rule normalization', () => {
        it('skips polymorphic target tables containing "("', () => {
            const schema = new RelationshipSchema(fixturePath);
            const hasPolymorphic = schema.getRules().some((r) => r.target_table.includes('('));
            expect(hasPolymorphic).toBe(false);
        });

        it('collapses unknown type variants (e.g. code_join) to "direct"', () => {
            const schema = new RelationshipSchema(fixturePath);
            const vpsToServers = schema.getRules().find(
                (r) => r.source_table === 'vps' && r.source_field === 'vps_server'
            );
            expect(vpsToServers).toBeDefined();
            expect(vpsToServers.type).toBe('direct');
        });

        it('preserves "find_in_set" type', () => {
            const schema = new RelationshipSchema(fixturePath);
            const found = schema.getRules().find((r) => r.type === 'find_in_set');
            expect(found).toBeDefined();
            expect(found.source_field).toBe('server_tags');
        });

        it('preserves "cross_db" type', () => {
            const schema = new RelationshipSchema(fixturePath);
            const found = schema.getRules().find((r) => r.type === 'cross_db');
            expect(found).toBeDefined();
            expect(found.target_db).toBe('kayako_v4');
        });

        it('defaults missing cardinality to "1:N"', () => {
            const schema = new RelationshipSchema(fixturePath);
            const minimal = schema.getRules().find((r) => r.source_table === 'minimal');
            expect(minimal).toBeDefined();
            expect(minimal.cardinality).toBe('1:N');
        });

        it('defaults missing label to empty string', () => {
            const schema = new RelationshipSchema(fixturePath);
            const minimal = schema.getRules().find((r) => r.source_table === 'minimal');
            expect(minimal.label).toBe('');
        });

        it('each rule exposes all expected keys', () => {
            const schema = new RelationshipSchema(fixturePath);
            const required = ['source_db', 'source_table', 'source_field',
                              'target_db', 'target_table', 'target_field',
                              'type', 'cardinality', 'label'];
            schema.getRules().forEach((rule) => {
                required.forEach((k) => expect(rule).toHaveProperty(k));
            });
        });

        it('skips rules with missing target_table', () => {
            const schema = new RelationshipSchema({
                relationships: [{
                    source_db: 'my', source_table: 'a', source_field: 'id',
                    target_db: 'my', target_field: 'id',
                }],
            });
            expect(schema.getRules()).toEqual([]);
        });
    });

    // ------------------------------------------------------------------
    // Accessors
    // ------------------------------------------------------------------
    describe('accessors', () => {
        it('getModules returns the modules map', () => {
            const schema = new RelationshipSchema(fixturePath);
            const modules = schema.getModules();
            expect(modules).toHaveProperty('accounts');
            expect(modules.accounts.prefix).toBe('account_');
        });

        it('getTableToModule returns the lookup map', () => {
            const schema = new RelationshipSchema(fixturePath);
            expect(schema.getTableToModule()).toHaveProperty('vps', 'vps');
        });

        it('getVirtualTables returns configured virtual tables', () => {
            const schema = new RelationshipSchema(fixturePath);
            expect(schema.getVirtualTables()).toHaveProperty('accounts_ext');
        });

        it('getMetadata returns the _metadata block', () => {
            const schema = new RelationshipSchema(fixturePath);
            expect(schema.getMetadata().version).toBe('1.0.0');
        });

        it('accessors return empty maps when their keys are missing', () => {
            const schema = new RelationshipSchema({});
            expect(schema.getModules()).toEqual({});
            expect(schema.getTableToModule()).toEqual({});
            expect(schema.getVirtualTables()).toEqual({});
            expect(schema.getMetadata()).toEqual({});
        });

        it('getRules returns empty array when relationships key is missing', () => {
            const schema = new RelationshipSchema({});
            expect(schema.getRules()).toEqual([]);
        });

        it('getRules returns empty array when relationships is not an array', () => {
            const schema = new RelationshipSchema({ relationships: 'not-an-array' });
            expect(schema.getRules()).toEqual([]);
        });
    });
});
