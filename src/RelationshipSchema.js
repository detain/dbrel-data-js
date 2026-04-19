'use strict';

const fs = require('fs');

/**
 * Loads and normalizes the relationship schema from a JSON file.
 *
 * Mirror of the PHP RelationshipSchema class - same JSON format, same output.
 */
class RelationshipSchema {
    /**
     * @param {string|object} jsonPathOrObj Either a path to the JSON file, or a pre-parsed object.
     */
    constructor(jsonPathOrObj) {
        if (typeof jsonPathOrObj === 'object' && jsonPathOrObj !== null) {
            this.data = jsonPathOrObj;
        } else if (typeof jsonPathOrObj === 'string') {
            if (!fs.existsSync(jsonPathOrObj)) {
                throw new Error('Schema file not found: ' + jsonPathOrObj);
            }
            const raw = fs.readFileSync(jsonPathOrObj, 'utf8');
            this.data = JSON.parse(raw);
        } else {
            throw new Error('Expected string path or object');
        }
        this._normalize();
    }

    _normalize() {
        this.rules = [];
        const rels = Array.isArray(this.data.relationships) ? this.data.relationships : [];
        for (const r of rels) {
            // Skip polymorphic placeholders
            if (!r.target_table || r.target_table.startsWith('(')) continue;
            let type = r.type || 'direct';
            if (type !== 'find_in_set' && type !== 'cross_db') type = 'direct';
            this.rules.push({
                source_db: r.source_db,
                source_table: r.source_table,
                source_field: r.source_field,
                target_db: r.target_db,
                target_table: r.target_table,
                target_field: r.target_field,
                type,
                cardinality: r.cardinality || '1:N',
                label: r.label || '',
            });
        }
    }

    getRules() { return this.rules; }
    getModules() { return this.data.modules || {}; }
    getTableToModule() { return this.data.table_to_module || {}; }
    getVirtualTables() { return this.data.virtual_tables || {}; }
    getMetadata() { return this.data._metadata || {}; }
    getRaw() { return this.data; }
}

module.exports = RelationshipSchema;
