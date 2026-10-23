'use strict';
const { RegimentStore } = require('./regimentStore');
const { ROLE_IDS, ZERO_SUM_SOURCE_GUILD_ID, ZERO_SUM_VERIFIED_ROLE_IDS, ZERO_SUM_OFFICER_ROLE_IDS, HUSS_SOURCE_GUILD_ID, HUSS_VERIFIED_ROLE_IDS, HUSS_OFFICER_ROLE_IDS } = require('./roleIds');
const LOL_GUILD_ID = '1521261614484033728';
const TARGET = { member: ROLE_IDS.MEMBER_ROLE_ID, officer: ROLE_IDS.REGIMENT_OFFICER_ROLE_ID, commander: ROLE_IDS.REGIMENTAL_LEADER_ROLE_ID };
const legacy = [
  { guildId: ZERO_SUM_SOURCE_GUILD_ID, members: ZERO_SUM_VERIFIED_ROLE_IDS, officers: ZERO_SUM_OFFICER_ROLE_IDS },
  { guildId: HUSS_SOURCE_GUILD_ID, members: HUSS_VERIFIED_ROLE_IDS, officers: HUSS_OFFICER_ROLE_IDS },
];
function errorText(e) { return `Sync failed (${e.code || e.name || 'unknown'}). Check bot access, role hierarchy and server availability.`; }
async function memberOrNull(guild, id) {
  try { return await guild.members.fetch({ user: id, force: true }); }
  catch (e) { if (e.code === 10007) return null; throw e; }
}
class RegimentService {
  constructor(client, store = new RegimentStore()) { this.client = client; this.store = store; this.tail = Promise.resolve(); }
  run(fn) { const next = this.tail.then(fn); this.tail = next.catch(() => {}); return next; }
  async guild(id) {
    const guild = this.client.guilds.cache.get(id);
    if (!guild || guild.available === false) throw new Error('Source or coalition server unavailable');
    return guild;
  }
  async desired(userId, data) {
    const roles = new Set();
    for (const r of data.regiments.filter(r => r.status === 'active')) {
      const guild = await this.guild(r.guildId);
      await guild.roles.fetch();
      if (!guild.roles.cache.has(r.memberRoleId) || !guild.roles.cache.has(r.officerRoleId)) throw new Error('Mapped source role was deleted');
      const m = await memberOrNull(guild, userId);
      if (!m) continue;
      if (!(r.seenUsers || []).includes(userId)) this.store.change(d => { const current = d.regiments.find(x => x.id === r.id); if (current) current.seenUsers = [...new Set([...(current.seenUsers || []), userId])]; });
      if (m.roles.cache.has(r.memberRoleId)) roles.add(TARGET.member);
      if (m.roles.cache.has(r.officerRoleId)) roles.add(TARGET.officer);
      if (m.id === r.commanderId) roles.add(TARGET.commander);
    }
    // Preserve the existing allied verification entitlement; registered mappings supersede it.
    for (const source of legacy) {
      if (data.regiments.some(r => r.guildId === source.guildId) || (data.disabledLegacy || []).includes(source.guildId)) continue;
      const guild = this.client.guilds.cache.get(source.guildId);
      if (!guild) continue;
      if (guild.available === false) throw new Error('Legacy source unavailable');
      const m = await memberOrNull(guild, userId);
      if (!m) continue;
      if (source.members.some(id => m.roles.cache.has(id))) roles.add(TARGET.member);
      if (source.officers.some(id => m.roles.cache.has(id))) roles.add(TARGET.officer);
    }
    return roles;
  }
  async syncUser(userId) {
    const data = this.store.read();
    const coalition = await this.guild(LOL_GUILD_ID);
    const member = await memberOrNull(coalition, userId);
    if (!member) { this.store.change(d => { delete d.grants[userId]; }); return; }
    const desired = await this.desired(userId, data);
    await coalition.roles.fetch();
    const me = await coalition.members.fetchMe();
    if (!me.permissions.has('ManageRoles')) throw new Error('Bot lacks Manage Roles');
    const owned = new Set(data.grants[userId] || []);
    for (const roleId of new Set([...desired, ...owned])) {
      const role = coalition.roles.cache.get(roleId);
      if (!role || role.managed || role.position >= me.roles.highest.position) throw new Error('Target role missing or not manageable');
      if (desired.has(roleId) && !member.roles.cache.has(roleId)) {
        // Durable intent BEFORE API request: recovery can retry or undo after interruption.
        this.store.change(d => { d.grants[userId] = [...new Set([...(d.grants[userId] || []), roleId])]; });
        await member.roles.add(roleId, 'Quartermaster regiment sync');
      } else if (!desired.has(roleId) && owned.has(roleId)) {
        if (member.roles.cache.has(roleId)) await member.roles.remove(roleId, 'Quartermaster regiment entitlement ended');
        this.store.change(d => { d.grants[userId] = (d.grants[userId] || []).filter(id => id !== roleId); });
      }
    }
  }
  async sweep(actor = {}, regimentId = null) {
    const snapshot = this.store.read();
    if (!actor.userId && !snapshot.regiments.length && !Object.keys(snapshot.grants).length) return { users: 0, failed: 0 };
    const coalition = await this.guild(LOL_GUILD_ID);
    const members = await coalition.members.fetch();
    // Recompute aggregate entitlement, even for a regiment sweep, so departed users are covered.
    let ids = new Set([...members.keys(), ...Object.keys(snapshot.grants)]);
    if (regimentId) {
      const r = snapshot.regiments.find(r => r.id === regimentId);
      if (!r) throw new Error('Regiment not found');
      ids = new Set([r.commanderId, ...(r.seenUsers || [])]);
      if (r.status === 'active') {
        const source = await this.guild(r.guildId);
        for (const id of (await source.members.fetch()).keys()) ids.add(id);
      }
    }
    let failed = 0;
    for (const id of ids) {
      try { await this.syncUser(id); }
      catch (e) { failed++; this.store.log('sync-error', actor, { subjectUserId: id, error: errorText(e) }); }
    }
    this.store.change(d => {
      for (const r of d.regiments) {
        if (regimentId && r.id !== regimentId) continue;
        r.syncError = failed ? `${failed} user(s) failed; automatic retry pending.` : null;
        if (!failed) r.lastSuccessfulSync = new Date().toISOString();
      }
      if (!failed) {
        const deleting = d.regiments.filter(r => r.status === 'deleting' && (!regimentId || r.id === regimentId));
        for (const r of deleting) this.store.audit(d, 'deletion-completed', actor, { regimentId: r.id });
        d.regiments = d.regiments.filter(r => !deleting.some(x => x.id === r.id));
      }
    });
    return { users: ids.size, failed };
  }
  async remove(id, actor) {
    this.store.change(d => {
      const r = d.regiments.find(r => r.id === id);
      if (!r) throw new Error('Regiment not found');
      r.status = 'deleting'; d.disabledLegacy = [...new Set([...(d.disabledLegacy || []), r.guildId])]; this.store.audit(d, 'deletion-requested', actor, { regimentId: id });
    });
    return this.sweep(actor, id);
  }
  report(e, actor = {}) {
    try { this.store.change(d => { this.store.audit(d, 'sync-error', actor, { error: errorText(e) }); for (const r of d.regiments) r.syncError = errorText(e); }); }
    catch { console.error('Regiment audit storage unavailable; no further mutation attempted.'); }
  }
  init() {
    const schedule = fn => this.run(fn).catch(e => this.report(e));
    const relevant = id => id === LOL_GUILD_ID || this.store.read().regiments.some(r => r.guildId === id) || legacy.some(r => r.guildId === id);
    this.client.on('guildMemberUpdate', (old, member) => {
      if (!old.roles.cache.equals(member.roles.cache)) schedule(async () => { if (relevant(member.guild.id)) await this.syncUser(member.id); });
    });
    for (const event of ['guildMemberAdd', 'guildMemberRemove']) this.client.on(event, m => {
      schedule(async () => { if (relevant(m.guild.id)) await this.syncUser(m.id); });
    });
    this.client.on('guildDelete', guild => {
      if (guild.available === false) return;
      schedule(async () => {
        this.store.change(d => { for (const r of d.regiments.filter(r => r.guildId === guild.id)) { r.status = 'suspended'; r.syncError = 'Bot removed from source server; registration suspended.'; this.store.audit(d, 'server-removed', { guildId: guild.id }, { regimentId: r.id }); } });
        await this.sweep();
      });
    });
    this.client.on('roleDelete', role => { schedule(async () => { if (relevant(role.guild.id)) await this.sweep(); }); });
    this.client.once('ready', () => {
      schedule(async () => {
        const missing = this.store.read().regiments.filter(r => r.status === 'active' && !this.client.guilds.cache.has(r.guildId));
        if (missing.length) this.store.change(d => { for (const r of d.regiments.filter(r => missing.some(x => x.id === r.id))) { r.status = 'suspended'; this.store.audit(d, 'server-absent-at-restart', { guildId: r.guildId }, { regimentId: r.id }); } });
        await this.sweep();
      });
      this.timer = setInterval(() => { if (!this.periodicPending) { this.periodicPending = true; schedule(async () => { try { await this.sweep(); } finally { this.periodicPending = false; } }); } }, 300000);
      this.timer.unref();
    });
  }
}
module.exports = { RegimentService, LOL_GUILD_ID, TARGET, errorText };



