'use strict';

/**
 * Collects rows from database queries into the normalized table structure.
 *
 * Works with any mysql2/promise-compatible connection. Pass the connection
 * into the constructor, then call `collect()` for each query you want to run.
 */
class DataCollector {
    /**
     * @param {object} conn A mysql2/promise Connection or Pool (has .query() returning [rows, fields])
     */
    constructor(conn) {
        this.conn = conn;
        this.tables = {}; // { 'db.table': { rows, total, columns, truncated } }
    }

    /**
     * Collect rows from a query into the tables map.
     *
     * @param {string} dbName Logical database name (e.g. 'my', 'kayako_v4', 'pdns')
     * @param {string} table Table name
     * @param {string} sql SELECT query
     * @param {Array} [params] Optional bind params
     * @param {number} [limit=50] Max rows to include in output
     * @returns {Promise<void>}
     */
    async collect(dbName, table, sql, params = [], limit = 50) {
        const key = dbName + '.' + table;
        const [rows] = await this.conn.query(sql, params);
        const total = rows.length;
        if (total === 0) return;

        const kept = rows.slice(0, limit);
        const columns = kept.length > 0 ? Object.keys(kept[0]) : [];

        this.tables[key] = {
            rows: kept,
            total,
            columns,
            truncated: total > limit,
        };
    }

    /**
     * Manually add a table entry (useful for computed/virtual tables).
     */
    addTable(dbName, table, rows, columns = null, total = null) {
        const key = dbName + '.' + table;
        if (!columns && rows.length > 0) columns = Object.keys(rows[0]);
        this.tables[key] = {
            rows,
            total: total !== null ? total : rows.length,
            columns: columns || [],
            truncated: false,
        };
    }

    /**
     * Append rows to an existing table (or create it).
     */
    appendRows(dbName, table, rows) {
        const key = dbName + '.' + table;
        if (!this.tables[key]) {
            this.addTable(dbName, table, rows);
        } else {
            rows.forEach((r) => {
                this.tables[key].rows.push(r);
                this.tables[key].total++;
            });
        }
    }

    getTables() { return this.tables; }
    has(key) { return key in this.tables; }
    getRows(key) { return this.tables[key] ? this.tables[key].rows : []; }
    getTotalRows() {
        return Object.values(this.tables).reduce((n, t) => n + t.total, 0);
    }
}

module.exports = DataCollector;
