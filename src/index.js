'use strict';

/**
 * @detain/dbrel-data-js
 *
 * Node.js backend data provider for database relationship visualization.
 * Sister package to @detain/dbrel-data-php — produces identical output
 * that the @detain/dbrel-viz frontend library consumes.
 */

module.exports = {
    RelationshipSchema: require('./RelationshipSchema'),
    RelationshipMatcher: require('./RelationshipMatcher'),
    DataCollector: require('./DataCollector'),
    DataProvider: require('./DataProvider'),
    version: require('../package.json').version,
};
