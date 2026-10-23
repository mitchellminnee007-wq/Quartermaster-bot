'use strict';
const fs = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { RegimentStore } = require('../utils/regimentStore');
const { getLegacySources } = require('../utils/legacyRegiments');
const seed = require('./legacyRegimentSources');
const FOUNDER = Object.freeze({ name: 'The Winged Hussars Industries', tag: 'HUSS', guildId: '1385714710405582858', commanderId: '781549558588112916', memberRoleId: '1386230860587733123', officerRoleId: '1386233581612826704' });
const MIGRATION = 'legacy-regiment-sources-v1';
function fingerprint(s) {
  return JSON.stringify({ key: s.key, guildId: s.guildId, members: s.members, officers: s.officers, memberRoleNames: s.memberRoleNames, officerRoleNames: s.officerRoleNames, targetTagRoleId: s.targetTagRoleId });
}
function plan(data, sources = seed, bootstrapHuss = false) {
  const current = getLegacySources(data);
  const add = [];
  for (const s of sources) {
    getLegacySources({ legacySources: [s] });
    const existing = current.filter(x => x.key === s.key || x.guildId === s.guildId);
    if (existing.length > 1 || (existing.length && fingerprint(existing[0]) !== fingerprint(s))) throw new Error(`Conflicting existing mapping: ${s.key}; no changes applied.`);
    if (!existing.length) add.push(s);
  }
  let founder = null;
  if (bootstrapHuss) {
    const matches = data.regiments.filter(r => r.guildId === FOUNDER.guildId || r.name.toLowerCase() === FOUNDER.name.toLowerCase() || r.tag.toLowerCase() === FOUNDER.tag.toLowerCase());
    if (matches.length && (matches.length !== 1 || matches[0].status !== 'active' || Object.entries(FOUNDER).some(([k,v]) => matches[0][k] !== v))) throw new Error('Conflicting HUSS registration; preserve existing record and resolve manually.');
    if (!matches.length) {
      if (data.regiments.some(r => r.status === 'pending_approval')) throw new Error('Pending applications exist; founding migration must not automatically start their polls.');
      founder = { ...FOUNDER, legacyCompatibility: true };
    }
  }
  return { migration: MIGRATION, founder, add, unchanged: sources.length - add.length, activeRegistrationsAdded: founder ? 1 : 0, needsMarker: !data.migrations?.[MIGRATION] };
}
function migrate(store, { apply = false, sources = seed, bootstrapHuss = false, actor = {} } = {}) {
  const before = store.read(), proposal = plan(before, sources, bootstrapHuss);
  if (!apply || (!proposal.add.length && !proposal.needsMarker && !proposal.founder)) return { ...proposal, applied: false };
  const exists = fs.existsSync(store.file);
  const bytes = exists ? fs.readFileSync(store.file) : null;
  const hash = bytes ? createHash('sha256').update(bytes).digest('hex') : null;
  const backup = exists ? `${store.file}.before-${MIGRATION}-${Date.now()}.bak` : null;
  if (backup) fs.writeFileSync(backup, bytes, { flag: 'wx', mode: 0o600 });
  store.change(d => {
    const currentHash = fs.existsSync(store.file) ? createHash('sha256').update(fs.readFileSync(store.file)).digest('hex') : null;
    if (currentHash !== hash) throw new Error('Database changed during migration; stop the bot and rerun the dry-run.');
    const checked = plan(d, sources, bootstrapHuss);
    d.legacySources = [...getLegacySources(d), ...structuredClone(checked.add)];
    if (checked.founder) {
      const r = { ...checked.founder, id: randomUUID(), status: 'active', registeredAt: new Date().toISOString(), lastSuccessfulSync: null, syncError: null, migration: MIGRATION };
      d.regiments.push(r);
      store.audit(d, 'existing-regiment-imported', actor, { regimentId: r.id, source: 'hardcoded HUSS roles; live guild/member verification; user-confirmed commander', commanderId: r.commanderId });
    }
    d.migrations = { ...d.migrations, [MIGRATION]: { timestamp: new Date().toISOString(), source: 'existing hardcoded mappings', count: sources.length } };
    store.audit(d, 'legacy-regiment-config-migrated', actor, { migration: MIGRATION, keys: checked.add.map(s => s.key), activeRegistrationsAdded: checked.activeRegistrationsAdded, backup });
  });
  return { ...proposal, applied: true, backup };
}
if (require.main === module) {
  try {
    const apply = process.argv.includes('--apply');
    if (apply && !process.argv.includes('--bot-stopped')) throw new Error('Apply requires --bot-stopped; stop the single bot writer first.');
    const result = migrate(new RegimentStore(), { apply, bootstrapHuss: process.argv.includes('--bootstrap-huss'), actor: { guildId: FOUNDER.guildId } });
    console.log(JSON.stringify({ migration: result.migration, mode: apply ? 'apply' : 'dry-run', applied: result.applied, add: result.add.map(s => ({ key: s.key, guildId: s.guildId, missingRegistrationFields: s.missingRegistrationFields })), unchanged: result.unchanged, activeRegistrationsAdded: result.activeRegistrationsAdded, founder: result.founder, backup: result.backup || null }, null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { migrate, plan, MIGRATION, FOUNDER };
