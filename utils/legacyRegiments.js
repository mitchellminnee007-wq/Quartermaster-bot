'use strict';
const { RegimentStore, ID } = require('./regimentStore');
function getLegacySources(data = new RegimentStore().read()) {
  if (data.legacySources === undefined) return [];
  if (!Array.isArray(data.legacySources)) throw new Error('Invalid persisted legacy regiment mappings.');
  for (const s of data.legacySources) {
    if (!ID.test(s.guildId) || !Array.isArray(s.members) || !Array.isArray(s.officers) || ![...s.members, ...s.officers, s.targetTagRoleId].every(id => ID.test(id)) || !Array.isArray(s.memberRoleNames) || !Array.isArray(s.officerRoleNames)) throw new Error('Invalid persisted legacy regiment mapping.');
  }
  return data.legacySources;
}
module.exports = { getLegacySources };
