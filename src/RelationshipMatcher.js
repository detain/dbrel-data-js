'use strict';

/**
 * Computes which rows in which tables match the relationship rules.
 * Mirror of the PHP RelationshipMatcher class.
 */
class RelationshipMatcher {
    /**
     * @param {Object} tablesData Map of "db.table" => { rows, total, columns }
     * @param {Array}  rules Relationship rules
     * @returns {Array} Active relationships with matches
     */
    compute(tablesData, rules) {
        const active = [];

        for (const rule of rules) {
            const sourceKey = rule.source_db + '.' + rule.source_table;
            const targetKey = rule.target_db + '.' + rule.target_table;

            if (!tablesData[sourceKey] || !tablesData[targetKey]) continue;

            const sourceRows = tablesData[sourceKey].rows;
            const targetRows = tablesData[targetKey].rows;
            const matches = [];

            if (rule.type === 'find_in_set') {
                sourceRows.forEach((srow, si) => {
                    const csv = srow[rule.source_field];
                    if (csv === null || csv === undefined || csv === '') return;
                    const ids = String(csv).split(',').map((s) => s.trim());
                    const matchedTargets = [];
                    targetRows.forEach((trow, ti) => {
                        const tval = trow[rule.target_field];
                        if (tval !== null && tval !== undefined && tval !== '' && ids.includes(String(tval))) {
                            matchedTargets.push(ti);
                        }
                    });
                    if (matchedTargets.length > 0) matches.push([si, matchedTargets]);
                });
            } else {
                sourceRows.forEach((srow, si) => {
                    const sval = srow[rule.source_field];
                    if (sval === null || sval === undefined || sval === '' || sval === '0' || sval === 0) return;
                    const matchedTargets = [];
                    targetRows.forEach((trow, ti) => {
                        const tval = trow[rule.target_field];
                        if (String(sval) === String(tval)) matchedTargets.push(ti);
                    });
                    if (matchedTargets.length > 0) matches.push([si, matchedTargets]);
                });
            }

            if (matches.length > 0) {
                active.push({
                    source: sourceKey,
                    source_field: rule.source_field,
                    target: targetKey,
                    target_field: rule.target_field,
                    type: rule.type,
                    cardinality: rule.cardinality,
                    label: rule.label,
                    matches,
                });
            }
        }

        return active;
    }
}

module.exports = RelationshipMatcher;
