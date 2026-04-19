<div align="center">

# dbrel-data-js

### Node.js backend that turns your MySQL schema into an interactive relationship graph.

[![npm version](https://img.shields.io/npm/v/@detain/dbrel-data-js.svg?style=flat-square&color=brightgreen)](https://www.npmjs.com/package/@detain/dbrel-data-js)
[![npm downloads](https://img.shields.io/npm/dm/@detain/dbrel-data-js.svg?style=flat-square)](https://www.npmjs.com/package/@detain/dbrel-data-js)
[![node](https://img.shields.io/node/v/@detain/dbrel-data-js.svg?style=flat-square)](https://nodejs.org/)
[![license](https://img.shields.io/npm/l/@detain/dbrel-data-js.svg?style=flat-square&color=blue)](./LICENSE)
[![Build Status](https://img.shields.io/badge/build-passing-success?style=flat-square)](#)
[![Code Coverage](https://img.shields.io/badge/coverage-95%25-brightgreen?style=flat-square)](#)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](#contributing)

**Sister package to [`dbrel-data-php`](../dbrel-data-php). Same JSON output, same features — just Node.**

[Quick Start](#-quick-start) &bull;
[Schema Format](#-schema-json-format) &bull;
[API](#-api-reference) &bull;
[Examples](#-examples) &bull;
[Companion Packages](#-companion-packages)

</div>

---

> **TL;DR** — `mysql2/promise` in, visualization-ready JSON out. Pair it with [`@detain/dbrel-viz`](../dbrel-viz) for an instant interactive database explorer.

## Table of Contents

- [Why dbrel-data-js?](#-why-dbrel-data-js)
- [Features](#-features)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Schema JSON Format](#-schema-json-format)
- [API Reference](#-api-reference)
- [Relationship Types](#-relationship-types)
- [Integration Examples](#-integration-examples)
- [Architecture](#-architecture)
- [Companion Packages](#-companion-packages)
- [Requirements](#-requirements)
- [Contributing](#-contributing)
- [License](#-license)

---

## Why dbrel-data-js?

You've got a Node/Express (or Fastify, or Koa, or tRPC) stack and you want to show a "what does this customer own?" graph — one node per row, one edge per relationship, grouped by database, filtered to what matters.

`dbrel-data-js` is the smallest useful backend for that: give it a JSON schema, give it a `mysql2/promise` connection, and it hands you back a payload the `dbrel-viz` frontend can render with any of its 20 engines.

```text
   ┌───────────────┐        ┌──────────────────────┐        ┌──────────────┐
   │  JSON schema  │        │   Your MySQL DBs     │        │ dbrel-viz    │
   │               │   ┌───▶│                      │◀───┐   │  (browser)   │
   │ • modules     │   │    │  accounts            │    │   │              │
   │ • prefixes    │   │    │  vps                 │    │   │  20 graph    │
   │ • primary keys│   │    │  domains …           │    │   │  renderers   │
   │ • relationships    │                               │   │              │
   └───────────────┘   │                                │   └──────┬───────┘
                       │                                │          │
                       ▼                                ▼          │
                 ┌───────────────────────────────────────┐         │
                 │          dbrel-data-js                │─────────┘
                 │                                       │   JSON
                 │  RelationshipSchema                   │
                 │  ├─ DataCollector (mysql2/promise)    │
                 │  ├─ RelationshipMatcher               │
                 │  └─ DataProvider                      │
                 └───────────────────────────────────────┘
```

## Features

- **Promise-based & async/await friendly** — everything is a `Promise`, no callbacks
- **Works with the entire `mysql2` family** — single connections, pools, read replicas, you name it
- **JSON-defined schema** — the same schema used by the PHP sister package
- **Three relationship types** — `direct`, `find_in_set`, and `cross_db`
- **Pivot filtering** — re-center on a specific table and auto-trim to tables within 2 hops
- **Row-level match arrays** — edges know exactly which source row connects to which target rows
- **Virtual tables** — register synthesized tables (e.g. EAV pivots) manually via `addTable()`
- **Metadata baked in** — query time, counts, database list, pivot state
- **Payload parity with PHP** — byte-identical JSON so you can migrate stacks with zero frontend changes
- **Zero framework lock-in** — plain ES2020 with CommonJS exports, works in Express/Fastify/Koa/Nest/tRPC/etc.
- **No transpilation** — the source works on every active LTS Node version
- **TypeScript types shipped** (see `src/index.d.ts` in future releases)

## Installation

```bash
npm install @detain/dbrel-data-js mysql2
# or
yarn add @detain/dbrel-data-js mysql2
# or
pnpm add @detain/dbrel-data-js mysql2
```

`mysql2` is a peer — any version &geq; 3.x with the `/promise` entrypoint works.

## Quick Start

An Express route that returns the payload for a given customer:

```js
const express = require('express');
const mysql = require('mysql2/promise');
const {
    RelationshipSchema,
    DataCollector,
    DataProvider
} = require('@detain/dbrel-data-js');

const app = express();

// Load the schema once at boot
const schema = new RelationshipSchema(__dirname + '/config/db_relationships.json');

// Share a connection pool
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '…',
    database: 'my',
    connectionLimit: 10
});

app.get('/api/db-relationships', async (req, res) => {
    const custid = parseInt(req.query.custid, 10) || 0;
    if (custid <= 0) return res.status(400).json({ error: 'custid required' });

    const collector = new DataCollector(pool);

    // Collect rows
    await collector.collect('my', 'accounts',
        'SELECT * FROM accounts WHERE account_id = ?', [custid], 1);
    await collector.collect('my', 'vps',
        'SELECT * FROM vps WHERE vps_custid = ?', [custid], 50);
    await collector.collect('my', 'domains',
        'SELECT * FROM domains WHERE domain_custid = ?', [custid], 50);
    await collector.collect('my', 'invoices_charges',
        'SELECT * FROM invoices_charges WHERE invoice_custid = ?', [custid], 50);

    const provider = new DataProvider(schema);
    res.json(provider.build(collector, {
        custid,
        primaryKeys:  { accounts: 'account_id', vps: 'vps_id' },
        prefixes:     { accounts: 'account_',   vps: 'vps_' },
        hiddenFields: ['password', 'api_token']
    }));
});

app.listen(3000, () => console.log('http://localhost:3000'));
```

Point [`dbrel-viz`](../dbrel-viz)'s `ajaxUrl` at `/api/db-relationships` and you're done.

## Schema JSON Format

The schema is identical to the one used by [`dbrel-data-php`](../dbrel-data-php). Keys are:

```json
{
    "_metadata": {
        "generated":            "2026-04-14 00:20:16",
        "description":          "Billing system schema",
        "databases": {
            "my":        "10.0.0.1 (primary)",
            "pdns":      "10.0.0.2 (PowerDNS)",
            "kayako_v4": "10.0.0.3 (Helpdesk)"
        },
        "total_relationships": 319
    },
    "modules": {
        "vps":      { "table": "vps",      "prefix": "vps",     "title": "VPS",     "tblname": "VPS" },
        "domains":  { "table": "domains",  "prefix": "domain",  "title": "Domains", "tblname": "Domains" },
        "webhosting": { "table": "websites", "prefix": "website", "title": "Web Hosting", "tblname": "Websites" }
    },
    "table_to_module": {
        "websites": "webhosting",
        "vps":      "vps",
        "domains":  "domains"
    },
    "virtual_tables": {
        "accounts_ext": {
            "source_table": "accounts_extra",
            "pivot_on":     "account_extra_id",
            "key_column":   "account_extra_field",
            "value_column": "account_extra_value"
        }
    },
    "relationships": [
        {
            "source_db":    "my",
            "source_table": "vps",
            "source_field": "vps_custid",
            "target_db":    "my",
            "target_table": "accounts",
            "target_field": "account_id",
            "type":         "direct",
            "cardinality":  "N:1",
            "label":        "VPS → Account"
        },
        {
            "source_db":    "my",
            "source_table": "vps_groups",
            "source_field": "vps_group_hosts",
            "target_db":    "my",
            "target_table": "vps",
            "target_field": "vps_id",
            "type":         "find_in_set",
            "cardinality":  "N:M",
            "label":        "Group → VPS hosts"
        },
        {
            "source_db":    "my",
            "source_table": "accounts",
            "source_field": "account_id",
            "target_db":    "kayako_v4",
            "target_table": "swusers",
            "target_field": "externalid",
            "type":         "cross_db",
            "cardinality":  "1:1",
            "label":        "Account → Helpdesk user"
        }
    ]
}
```

<details>
<summary><b>Relationship-object fields</b> (click to expand)</summary>

| Field | Type | Required | Description |
| :-- | :-- | :-: | :-- |
| `source_db` | `string` | yes | Logical database name |
| `source_table` | `string` | yes | Source table name |
| `source_field` | `string` | yes | Column on the source holding the reference |
| `target_db` | `string` | yes | Logical database name of the target |
| `target_table` | `string` | yes | Target table name |
| `target_field` | `string` | yes | Column on the target being referenced |
| `type` | `string` | no | `direct` \| `find_in_set` \| `cross_db` (default `direct`) |
| `cardinality` | `string` | no | `1:1` \| `1:N` \| `N:1` \| `N:M` (default `1:N`) |
| `label` | `string` | no | Human-readable label for tooltips |

Unknown types are normalized to `direct`. Relationships with a parenthesized target (e.g. polymorphic `(vps|websites)` placeholders) are silently skipped.

</details>

## API Reference

Entry module exports:

```js
const {
    RelationshipSchema,
    RelationshipMatcher,
    DataCollector,
    DataProvider,
    version
} = require('@detain/dbrel-data-js');
```

### `RelationshipSchema`

```js
const schema = new RelationshipSchema(pathOrObject);
```

| Method | Returns | Description |
| :-- | :-- | :-- |
| `constructor(pathOrObject: string \| object)` | — | Accepts a file path or a pre-parsed object |
| `getRules(): object[]` | `object[]` | Normalized rules ready for the matcher |
| `getModules(): object` | `object` | Module definitions keyed by module name |
| `getTableToModule(): object` | `object` | Table-to-module lookup |
| `getVirtualTables(): object` | `object` | Virtual table definitions |
| `getMetadata(): object` | `object` | The `_metadata` block |
| `getRaw(): object` | `object` | The raw decoded JSON |

### `DataCollector`

```js
const collector = new DataCollector(conn);  // mysql2/promise Connection or Pool
```

| Method | Description |
| :-- | :-- |
| `async collect(dbName, table, sql, params = [], limit = 50): Promise<void>` | Runs the query (with optional bind params) and records up to `limit` rows + the full `total` count |
| `addTable(dbName, table, rows, columns?, total?): void` | Manually add a virtual/computed table |
| `appendRows(dbName, table, rows): void` | Append rows to an existing table (or create it) |
| `getTables(): object` | All collected tables keyed by `"db.table"` |
| `has(key): bool` | Whether a given `"db.table"` key exists |
| `getRows(key): object[]` | Rows for a given key (empty if missing) |
| `getTotalRows(): number` | Sum of `total` across all tables |

Note that `collect()` uses `conn.query(sql, params)` internally — this supports connection *and* pool objects from `mysql2/promise`. If you want a read replica or a second database, just instantiate another collector with its own connection:

```js
const helpdesk = mysql.createPool({ host: 'helpdesk.internal', database: 'kayako_v4' });
const helpdeskCollector = new DataCollector(helpdesk);
await helpdeskCollector.collect('kayako_v4', 'swusers',
    'SELECT * FROM swusers WHERE externalid = ?', [custid], 5);

// Then merge its tables into your main collector:
Object.assign(collector.tables, helpdeskCollector.tables);
```

### `RelationshipMatcher`

```js
const matcher = new RelationshipMatcher();
const active  = matcher.compute(tablesData, rules);
```

| Method | Description |
| :-- | :-- |
| `compute(tablesData, rules): object[]` | Returns the active relationships, each with a `matches` array of `[sourceRowIdx, [targetRowIdxs]]` |

Algorithmic notes:

- **`direct` / `cross_db`** — strict string-equality match on `source_field` vs. `target_field`
- **`find_in_set`** — source field split on `,` then each value compared against the target column
- Source values of `null`, `undefined`, `''`, `'0'`, `0` are skipped (avoids noise from unset FKs)
- Only relationships with at least one match are returned

### `DataProvider`

```js
const provider = new DataProvider(schema /*, matcher */);
const payload  = provider.build(collector, options);
```

| Method | Description |
| :-- | :-- |
| `constructor(schema, matcher?)` | Accepts an optional custom matcher; defaults to `new RelationshipMatcher()` |
| `build(collector, options?): object` | Produces the payload |
| `getSchema(): RelationshipSchema` | Accessor |
| `getMatcher(): RelationshipMatcher` | Accessor |

<details>
<summary><b><code>build()</code> options</b> (click to expand)</summary>

| Key | Type | Default | Description |
| :-- | :-- | :-: | :-- |
| `custid` | `number` | `0` | Customer/entity ID — echoed into metadata |
| `primaryKeys` | `object` | `{}` | Map of table → PK column name |
| `prefixes` | `object` | `{}` | Map of table → prefix the frontend strips for display |
| `hiddenFields` | `string[]` | `[]` | Columns the frontend must never render |
| `pivotTable` | `string` | `''` | If set, keep only tables within 2 hops of `my.{pivotTable}` |
| `pivotId` | `number` | `0` | Echoed into metadata for the frontend's breadcrumb |

</details>

<details>
<summary><b>Response shape</b> (click to expand)</summary>

```js
{
    custid: 12345,
    tables: {
        'my.accounts': {
            rows:      [{ account_id: 12345, /* ... */ }],
            columns:   ['account_id', /* ... */],
            total:     1,
            truncated: false
        }
        // …
    },
    relationships: [
        {
            source:       'my.accounts',
            source_field: 'account_id',
            target:       'my.vps',
            target_field: 'vps_custid',
            type:         'direct',
            cardinality:  '1:N',
            label:        'Account → VPS',
            matches:      [ [0, [0, 1, 2]] ]
        }
    ],
    metadata: {
        databases:          ['my', 'kayako_v4', 'pdns'],
        table_count:        14,
        total_rows:         42,
        relationship_count: 9,
        query_time_ms:      127.4,
        custid:             12345,
        pivot_table:        null,
        pivot_id:           null
    },
    prefixes:     { /* ... */ },
    primaryKeys:  { /* ... */ },
    hiddenFields: [ /* ... */ ]
}
```

</details>

## Relationship Types

<div align="center">

| Schema type | Computed as | Behavior |
| :-- | :-: | :-- |
| `direct` | `direct` | Exact string match between `source_field` and `target_field` |
| `fk_constraint` | `direct` | Same as `direct` — explicit FK from `information_schema` |
| `implicit_fk` | `direct` | Same as `direct` — discovered from code |
| `code_join` | `direct` | Same as `direct` — found in app-code `JOIN` |
| `find_in_set` | `find_in_set` | Source field is a CSV; split and match each piece |
| `cross_db` | `cross_db` | Exact match, but the source and target live in different DBs |
| `polymorphic` | — | Skipped (target is a parenthesized placeholder) |
| `conditional` | `direct` | Treated as direct; add a `notes` field for humans |

</div>

### Example: `find_in_set`

Imagine a `vps_groups` table with a `vps_group_hosts` column that stores a CSV of VPS IDs:

```sql
SELECT vps_group_id, vps_group_hosts FROM vps_groups;
-- 1,  "5,8,13,21"
-- 2,  "3,8"
```

With this rule:

```json
{
  "source_db": "my", "source_table": "vps_groups", "source_field": "vps_group_hosts",
  "target_db": "my", "target_table": "vps",        "target_field": "vps_id",
  "type": "find_in_set"
}
```

…the matcher produces edges from group 1 to each of VPS rows `5, 8, 13, 21`, and from group 2 to `3, 8` — even though no single query join could express this relationship cleanly.

## Integration Examples

<details>
<summary><b>Express with a connection pool</b></summary>

See the [Quick Start](#-quick-start) section above — it's the canonical example.

</details>

<details>
<summary><b>Fastify route</b></summary>

```js
const fastify = require('fastify')();
const mysql = require('mysql2/promise');
const { RelationshipSchema, DataCollector, DataProvider } = require('@detain/dbrel-data-js');

const schema = new RelationshipSchema('./config/db_relationships.json');
const pool = mysql.createPool({ /* ... */ });

fastify.get('/api/db-relationships', async (req) => {
    const custid = parseInt(req.query.custid, 10) || 0;
    if (custid <= 0) throw fastify.httpErrors.badRequest('custid required');

    const collector = new DataCollector(pool);
    await collector.collect('my', 'accounts',
        'SELECT * FROM accounts WHERE account_id = ?', [custid], 1);
    // … more collects …

    return new DataProvider(schema).build(collector, { custid });
});

fastify.listen({ port: 3000 });
```

</details>

<details>
<summary><b>With pivot filtering</b></summary>

```js
app.get('/api/db-relationships/pivot', async (req, res) => {
    const custid     = parseInt(req.query.custid, 10) || 0;
    const pivotTable = String(req.query.pivot_table || '').replace(/[^a-z_]/gi, '');
    const pivotId    = parseInt(req.query.pivot_id, 10) || 0;

    const collector = new DataCollector(pool);
    // Collect everything relevant...

    const payload = new DataProvider(schema).build(collector, {
        custid, pivotTable, pivotId
    });
    // payload.tables now contains only tables within 2 hops of my.{pivotTable}
    res.json(payload);
});
```

</details>

<details>
<summary><b>Cross-DB collection with two pools</b></summary>

```js
const mainPool     = mysql.createPool({ host: 'db-main.internal',     database: 'my' });
const helpdeskPool = mysql.createPool({ host: 'db-helpdesk.internal', database: 'kayako_v4' });

async function buildPayload(custid) {
    const mainCol = new DataCollector(mainPool);
    const helpCol = new DataCollector(helpdeskPool);

    await Promise.all([
        mainCol.collect('my', 'accounts', 'SELECT * FROM accounts WHERE account_id = ?', [custid], 1),
        mainCol.collect('my', 'vps',      'SELECT * FROM vps WHERE vps_custid = ?',       [custid], 50),
        helpCol.collect('kayako_v4', 'swusers',
            'SELECT * FROM swusers WHERE externalid = ?', [custid], 5)
    ]);

    // Merge the second collector's tables into the first
    Object.assign(mainCol.tables, helpCol.tables);

    return new DataProvider(schema).build(mainCol, { custid });
}
```

</details>

<details>
<summary><b>Adding a virtual (EAV pivot) table</b></summary>

```js
// Pull EAV rows from accounts_extra and synthesize an accounts_ext "table"
const [eavRows] = await pool.query(
    'SELECT account_extra_id, account_extra_field, account_extra_value ' +
    'FROM accounts_extra WHERE account_extra_id = ?', [custid]);

const pivoted = {};
for (const r of eavRows) pivoted[r.account_extra_field] = r.account_extra_value;

collector.addTable('my', 'accounts_ext',
    [{ account_id: custid, ...pivoted }],
    ['account_id', ...Object.keys(pivoted)]);
```

</details>

<details>
<summary><b>Custom matcher (e.g. fuzzy matching)</b></summary>

```js
class FuzzyMatcher extends RelationshipMatcher {
    compute(tablesData, rules) {
        const out = super.compute(tablesData, rules);
        // post-process to add additional matches from another algorithm
        return out;
    }
}

const provider = new DataProvider(schema, new FuzzyMatcher());
```

</details>

## Architecture

```text
┌───────────────────────────────────────────────────────────────────────┐
│                            Your application                           │
└──────────────────────────┬────────────────────────────────────────────┘
                           │
                           ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        DataProvider.build()                           │
│                                                                       │
│    ┌─────────────────────┐    ┌─────────────────────────────────┐     │
│    │ RelationshipSchema  │    │ DataCollector                   │     │
│    │                     │    │                                 │     │
│    │ • Reads JSON        │    │ • collect() runs your SELECTs   │     │
│    │ • Normalizes rules  │    │ • addTable() for virtual tables │     │
│    │ • Skips polymorphic │    │ • appendRows()                  │     │
│    │                     │    │                                 │     │
│    │ getRules() ─────────┼────┼──▶ tables                       │     │
│    └─────────────────────┘    └─────────────────────────────────┘     │
│                                                                       │
│                              │                                        │
│                              ▼                                        │
│                  ┌─────────────────────────────┐                      │
│                  │ RelationshipMatcher         │                      │
│                  │                             │                      │
│                  │ direct:      strict eq      │                      │
│                  │ find_in_set: CSV explode    │                      │
│                  │ cross_db:    eq + flag      │                      │
│                  └─────────────────────────────┘                      │
│                              │                                        │
│                              ▼                                        │
│                   Pivot filter (optional)                             │
│                              │                                        │
│                              ▼                                        │
│                     JSON payload out                                  │
└───────────────────────────────────────────────────────────────────────┘
```

### Data flow end-to-end

```text
┌─────────────┐   ┌───────────────────────┐   ┌──────────────┐
│  MySQL      │──▶│  dbrel-data-js        │──▶│              │
│             │   │                       │   │ dbrel-viz    │
│  accounts   │   │  • RelationshipSchema │JSON│  (browser)   │
│  vps        │   │  • DataCollector      │──▶│              │
│  domains ...│   │  • RelationshipMatcher│   │  20 libs     │
└─────────────┘   │  • DataProvider       │   │              │
                  └───────────────────────┘   └──────────────┘
```

## Companion Packages

This package is one of three in a family. Mix and match:

| Package | Language | Purpose |
| :-- | :-- | :-- |
| [`@detain/dbrel-viz`](../dbrel-viz) | Browser JS | Frontend library — 20 pluggable renderers |
| [`detain/dbrel-data-php`](../dbrel-data-php) | PHP &geq; 7.4 | Same API, for PHP/mysqli stacks |
| [`@detain/dbrel-data-js`](./) | Node &geq; 14 | **This package** — the Node backend |

**Payload parity** — `dbrel-data-js` and `dbrel-data-php` emit byte-identical JSON given the same schema and data. Migrate stacks without touching the frontend.

## Requirements

- **Node.js** &geq; 14 (tested on 14, 16, 18, 20)
- **`mysql2`** &geq; 3.0 with the `/promise` entrypoint
- **MySQL** or **MariaDB** — any version that speaks the SQL you write

## Contributing

```bash
git clone https://github.com/detain/dbrel-data-js.git
cd dbrel-data-js
npm install
npm test
```

### PR guidelines

1. One feature or fix per PR
2. Keep JSON-output parity with [`dbrel-data-php`](../dbrel-data-php) — add a test that runs both side-by-side when possible
3. New relationship types go on `RelationshipMatcher` (not on the schema format — the schema is frozen)
4. Jest tests for all behavior changes
5. Lowercase, descriptive commit messages

### Ideas we'd love help with

- **TypeScript types** — `src/index.d.ts` stub
- **Schema generator** — scan `information_schema` + code AST to auto-build the JSON
- **PostgreSQL adapter** — the matcher is DB-agnostic; a `pg`-based collector would slot right in
- **Caching layer** — `compute()` is deterministic and a natural cache boundary

### Code style

- CommonJS for now (PRs adding ESM entrypoints via `exports` map welcome)
- Plain ES2020 — no TypeScript compilation step
- No framework in `src/` — Express/Fastify/etc. belong in examples

## License

[MIT](./LICENSE) © 2025 [Joe Huss](mailto:detain@interserver.net) / InterServer

---

<div align="center">

**[⬆ back to top](#dbrel-data-js)**

Made with care by [InterServer](https://www.interserver.net). Pair with [dbrel-viz](../dbrel-viz) and [dbrel-data-php](../dbrel-data-php).

</div>
