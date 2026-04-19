'use strict';

const RelationshipMatcher = require('./RelationshipMatcher');

/**
 * Main entry point for building the visualization payload.
 *
 * Given a configured RelationshipSchema and a DataCollector with collected rows,
 * produces the JSON response consumed by the @detain/dbrel-viz JS library.
 */
class DataProvider {
    /**
     * @param {RelationshipSchema} schema
     * @param {RelationshipMatcher} [matcher]
     */
    constructor(schema, matcher = null) {
        this.schema = schema;
        this.matcher = matcher || new RelationshipMatcher();
        this.startTime = Date.now();
    }

    /**
     * Build the response payload.
     *
     * @param {DataCollector} collector
     * @param {object} [options]
     * @param {number} [options.custid=0]
     * @param {object} [options.primaryKeys={}]
     * @param {object} [options.prefixes={}]
     * @param {Array}  [options.hiddenFields=[]]
     * @param {string} [options.pivotTable='']
     * @param {number} [options.pivotId=0]
     * @returns {object}
     */
    build(collector, options = {}) {
        const {
            custid = 0,
            primaryKeys = {},
            prefixes = {},
            hiddenFields = [],
            pivotTable = '',
            pivotId = 0,
        } = options;

        let tables = collector.getTables();
        const rules = this.schema.getRules();

        if (pivotTable && pivotId > 0) {
            const pivotKey = 'my.' + pivotTable;
            if (tables[pivotKey]) {
                tables = this._filterByPivot(tables, rules, pivotKey);
            }
        }

        const relationships = this.matcher.compute(tables, rules);

        return {
            custid,
            tables,
            relationships,
            metadata: {
                databases: Object.keys((this.schema.getMetadata().databases) || { my: '', kayako_v4: '', pdns: '' }),
                table_count: Object.keys(tables).length,
                total_rows: collector.getTotalRows(),
                relationship_count: relationships.length,
                query_time_ms: Math.round((Date.now() - this.startTime) * 100) / 100,
                custid,
                pivot_table: pivotTable || null,
                pivot_id: pivotId || null,
            },
            prefixes,
            primaryKeys,
            hiddenFields,
        };
    }

    /**
     * Filter tables to only include those within 2 hops of the pivot table.
     * Always keeps 'my.accounts' for context.
     */
    _filterByPivot(tables, rules, pivotKey) {
        const connected = { [pivotKey]: true };
        for (const rule of rules) {
            const s = rule.source_db + '.' + rule.source_table;
            const t = rule.target_db + '.' + rule.target_table;
            if (s === pivotKey) connected[t] = true;
            if (t === pivotKey) connected[s] = true;
        }
        const secondHop = {};
        for (const ctk of Object.keys(connected)) {
            for (const rule of rules) {
                const s = rule.source_db + '.' + rule.source_table;
                const t = rule.target_db + '.' + rule.target_table;
                if (s === ctk && !connected[t]) secondHop[t] = true;
                if (t === ctk && !connected[s]) secondHop[s] = true;
            }
        }
        Object.assign(connected, secondHop);

        const filtered = {};
        for (const key of Object.keys(tables)) {
            if (connected[key]) filtered[key] = tables[key];
        }
        if (tables['my.accounts']) filtered['my.accounts'] = tables['my.accounts'];
        return filtered;
    }

    getSchema() { return this.schema; }
    getMatcher() { return this.matcher; }
}

module.exports = DataProvider;
