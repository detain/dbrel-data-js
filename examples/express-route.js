'use strict';

/**
 * Minimal example: Express.js route using dbrel-data-js
 *
 * Run with:
 *   npm install express mysql2 @detain/dbrel-data-js
 *   node express-route.js
 *
 * Then visit http://localhost:3000/api/db-rel?custid=123
 */

const express = require('express');
const mysql = require('mysql2/promise');
const {
    RelationshipSchema,
    DataCollector,
    DataProvider,
} = require('../src');

const app = express();

// Load the schema once at startup
const schema = new RelationshipSchema(__dirname + '/sample_schema.json');

app.get('/api/db-rel', async (req, res) => {
    const custid = parseInt(req.query.custid, 10);
    if (!custid || custid <= 0) {
        return res.status(400).json({ error: 'Invalid custid' });
    }

    const conn = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'my',
    });

    try {
        const collector = new DataCollector(conn);

        // Collect core data
        await collector.collect('my', 'accounts',
            'SELECT * FROM accounts WHERE account_id = ?', [custid], 1);

        await collector.collect('my', 'vps',
            'SELECT * FROM vps WHERE vps_custid = ?', [custid], 50);

        await collector.collect('my', 'websites',
            'SELECT * FROM websites WHERE website_custid = ?', [custid], 50);

        await collector.collect('my', 'domains',
            'SELECT * FROM domains WHERE domain_custid = ?', [custid], 50);

        // Build the response
        const provider = new DataProvider(schema);
        const response = provider.build(collector, {
            custid,
            primaryKeys: {
                accounts: 'account_id',
                vps: 'vps_id',
                websites: 'website_id',
                domains: 'domain_id',
            },
            prefixes: {
                accounts: 'account_',
                vps: 'vps_',
                websites: 'website_',
                domains: 'domain_',
            },
            hiddenFields: ['password'],
            pivotTable: req.query.pivot_table || '',
            pivotId: parseInt(req.query.pivot_id, 10) || 0,
        });

        res.json(response);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        await conn.end();
    }
});

app.listen(3000, () => {
    console.log('Listening on http://localhost:3000');
});
