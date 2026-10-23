'use strict';
const { RegimentStore } = require('./regimentStore');
const { ROLE_IDS } = require('./roleIds');
const { getLegacySources } = require('./legacyRegiments');
const LOL_GUILD_ID = '1521261614484033728';
const TARGET = { member: ROLE_IDS.MEMBER_ROLE_ID, officer: ROLE_IDS.REGIMENT_OFFICER_ROLE_ID, commander: ROLE_IDS.REGIMENTAL_LEADER_ROLE_ID };
function syncFailure(code, message) { return Object.assign(new Error(message), { syncCode: code, safeDetail: message }); }
function errorText(e) {
  if (e.syncCode && e.safeDetail) return `Sync failed (${e.syncCode}): ${e.safeDetail}`;
  const known = { 50013: 'Discord denied permission. Check Manage Roles and the target role hierarchy in LOL.', 50001: 'Discord denied access to the requested server or resource.', 10004: 'Discord could not find the source or coalition server.', 10011: 'Discord could not find the configured role.', GuildMembersTimeout: 'Fetching server members timed out. Check Guild Members intent and connection; retry later.' };
  const code = Object.hasOwn(known, e.code) ? e.code : 'UNCLASSIFIED';
  return `Sync failed (${code}): ${known[code] || 'An unexpected operation failed. No raw API or secret details are displayed.'}`;
}
async function memberOrNull(guild, id) {
  try { return await guild.members.fetch({ user: id, force: true }); }
  catch (e) { if (e.code === 10007) return null; throw e; }
}
class RegimentService {
  constructor(client, store = new RegimentStore()) { this.client = client; this.store = store; this.tail = Promise.resolve(); this.approvals = new (require('./regimentApproval').ApprovalNotifications)(this); }
  run(fn) { const next = this.tail.then(fn); this.tail = next.catch(() => {}); return next; }
  async guild(id) {
    const guild = this.client.guilds.cache.get(id);
    if (!guild || guild.available === false) throw syncFailure('SERVER_UNAVAILABLE', `Server ${id} is absent from the bot cache or unavailable.`);
    return guild;
  }
  async desired(userId, data, context = {}) {
    const sourceMembers = new Map();
    const roles = new Set();
    for (const r of data.regiments.filter(r => r.status === 'active')) {
      const guild = await this.guild(r.guildId);
      context.rolesFetched ||= new Set();
      if (!context.rolesFetched.has(guild.id)) { await guild.roles.fetch(); context.rolesFetched.add(guild.id); }
      if (!guild.roles.cache.has(r.memberRoleId) || !guild.roles.cache.has(r.officerRoleId)) throw syncFailure('SOURCE_ROLE_MISSING', `Server ${r.guildId}: Member ${r.memberRoleId} or Officer ${r.officerRoleId} no longer exists.`);
      const m = sourceMembers.has(guild.id) ? sourceMembers.get(guild.id) : await memberOrNull(guild, userId);
      sourceMembers.set(guild.id, m);
      if (!m) continue;
      if (!(r.seenUsers || []).includes(userId)) this.store.change(d => { const current = d.regiments.find(x => x.id === r.id); if (current) current.seenUsers = [...new Set([...(current.seenUsers || []), userId])]; });
      if (m.roles.cache.has(r.memberRoleId)) roles.add(TARGET.member);
      if (m.roles.cache.has(r.officerRoleId)) roles.add(TARGET.officer);
      if (m.id === r.commanderId) roles.add(TARGET.commander);
      if (r.tagRoleId && r.tagRoleProvision?.enabled && r.tagRoleProvision.roleId === r.tagRoleId && (m.roles.cache.has(r.memberRoleId) || m.roles.cache.has(r.officerRoleId) || m.id === r.commanderId)) {
        if (r.tagRoleProvision.state !== 'ready') throw syncFailure('TAG_ROLE_PENDING', `Regiment ${r.id}: tag provisioning needs recovery before synchronization.`);
        roles.add(r.tagRoleId);
      }
    }
    // Preserve the existing allied verification entitlement; registered mappings supersede it.
    for (const source of getLegacySources(data)) {
      if (data.regiments.some(r => r.guildId === source.guildId && !r.legacyCompatibility) || (data.disabledLegacy || []).includes(source.guildId)) continue;
      const guild = this.client.guilds.cache.get(source.guildId);
      if (!guild) continue;
      if (guild.available === false) throw syncFailure('LEGACY_UNAVAILABLE', `Legacy server ${source.guildId} is temporarily unavailable.`);
      const m = sourceMembers.has(guild.id) ? sourceMembers.get(guild.id) : await memberOrNull(guild, userId);
      sourceMembers.set(guild.id, m);
      if (!m) continue;
      if (source.members.some(id => m.roles.cache.has(id))) roles.add(TARGET.member);
      if (source.officers.some(id => m.roles.cache.has(id))) roles.add(TARGET.officer);
    }
    return roles;
  }
  async syncUser(userId, context = {}) {
    try { return await this.syncUserRaw(userId, context); }
    catch (e) { e.isSyncError = true; throw e; }
  }
  async syncUserRaw(userId, context) {
    const data = this.store.read();
    const coalition = await this.guild(LOL_GUILD_ID);
    const member = await memberOrNull(coalition, userId);
    if (!member) { this.store.change(d => { delete d.grants[userId]; }); return; }
    const desired = await this.desired(userId, data, context);
    context.rolesFetched ||= new Set();
    if (!context.rolesFetched.has(coalition.id)) { await coalition.roles.fetch(); context.rolesFetched.add(coalition.id); }
    const me = await coalition.members.fetchMe();
    if (!me.permissions.has('ManageRoles')) throw syncFailure('MANAGE_ROLES_MISSING', `Bot lacks Manage Roles in LOL (${LOL_GUILD_ID}).`);
    const owned = new Set(data.grants[userId] || []);
    for (const roleId of new Set([...desired, ...owned])) {
      const role = coalition.roles.cache.get(roleId);
      if (!role || role.managed || role.position >= me.roles.highest.position) throw syncFailure('TARGET_ROLE_UNMANAGEABLE', `LOL role ${roleId} is not manageable: missing, managed, or at/above the bot highest role. Place the bot role above this target role.`);
      if (desired.has(roleId) && data.regiments.some(r => r.tagRoleId === roleId) && (BigInt(role.permissions?.bitfield ?? -1) !== 0n || role.hoist || role.mentionable)) throw syncFailure('TAG_ROLE_UNSAFE', `Tag role ${roleId} no longer has the approved permissionless settings.`);
      if (desired.has(roleId) && !member.roles.cache.has(roleId)) {
        // Durable intent BEFORE API request: recovery can retry or undo after interruption.
        this.store.change(d => { d.grants[userId] = [...new Set([...(d.grants[userId] || []), roleId])]; });
        await member.roles.add(roleId, 'Quartermaster regiment sync');
      } else if (!desired.has(roleId) && owned.has(roleId)) {
        if (member.roles.cache.has(roleId)) await member.roles.remove(roleId, 'Quartermaster regiment entitlement ended');
        this.store.change(d => { d.grants[userId] = (d.grants[userId] || []).filter(id => id !== roleId); });
      }
    }
    await require('./regimentNickname').reconcileNickname(this, member, data, context);
  }
  async sweep(actor = {}, regimentId = null, progress = null) {
    this.activeSync = { regimentId, completed: 0, total: 0, failed: 0 };
    try { return await this.sweepRaw(actor, regimentId, progress); }
    catch (e) { e.isSyncError = true; throw e; }
    finally { this.activeSync = null; }
  }
  async sweepRaw(actor = {}, regimentId = null, progress = null) {
    const snapshot = this.store.read();
    if (!actor.userId && !snapshot.regiments.some(r => (['deleting', 'suspended'].includes(r.status) || (r.status === 'active' && !r.legacyCompatibility))) && !Object.keys(snapshot.grants).length) return { users: 0, failed: 0 };
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
    // Coalition membership was just fetched. Absent source members need no role API request;
    // include owned grants so departure cleanup is never skipped. Join events reconcile later joins.
    ids = new Set([...ids].filter(id => members.has(id) || Object.hasOwn(snapshot.grants, id)));
    let failed = 0, firstFailure = null, completed = 0;
    const context = { rolesFetched: new Set() };
    const update = async () => {
      this.activeSync = { regimentId, completed, total: ids.size, failed };
      if (progress) { try { await progress(this.activeSync); } catch { /* Expired interaction must not interrupt durable role reconciliation. */ } }
    };
    await update();
    for (const id of ids) {
      try { await this.syncUser(id, context); }
      catch (e) { failed++; firstFailure ||= errorText(e); this.store.log('sync-error', actor, { subjectUserId: id, error: errorText(e) }); }
      completed++; await update();
    }
    this.store.change(d => {
      for (const r of d.regiments) {
        if ((regimentId && r.id !== regimentId) || !['active', 'deleting', 'suspended'].includes(r.status)) continue;
        r.syncError = failed ? `${failed} user(s) failed; ${firstFailure} Automatic retry pending.` : null;
        if (!failed) r.lastSuccessfulSync = new Date().toISOString();
      }
      if (!failed) {
        const deleting = d.regiments.filter(r => r.status === 'deleting' && (!regimentId || r.id === regimentId));
        for (const r of deleting) this.store.audit(d, 'deletion-completed', actor, { regimentId: r.id });
        d.regiments = d.regiments.filter(r => !deleting.some(x => x.id === r.id));
      }
    });
    this.store.log('sync-completed', actor, { regimentId, users: ids.size, failed });
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
  reportCommand(e, actor = {}, command = 'unknown') {
    if (e.isSyncError) return this.report(e, actor);
    const expected = new Set(['You are not authorized for this action.', 'Regiment not found. Use its exact name in LOL or run this in the regiment server.', 'Only approved active regiments can be synchronized.', 'Unsupported control.']);
    this.store.log('command-error', actor, { command, error: expected.has(e.message) ? e.message : 'Command failed before or outside role synchronization.' });
  }
  report(e, actor = {}) {
    try { this.store.change(d => { this.store.audit(d, 'sync-error', actor, { error: errorText(e) }); for (const r of d.regiments) r.syncError = errorText(e); }); }
    catch { console.error('Regiment audit storage unavailable; no further mutation attempted.'); }
  }
  init() {
    const schedule = fn => this.run(fn).catch(e => this.report(e));
    const relevant = id => id === LOL_GUILD_ID || this.store.read().regiments.some(r => r.guildId === id) || getLegacySources(this.store.read()).some(r => r.guildId === id);
    this.client.on('guildMemberUpdate', (old, member) => {
      if (!old.roles.cache.equals(member.roles.cache)) schedule(async () => { if (relevant(member.guild.id)) await this.syncUser(member.id); });
    });
    for (const event of ['guildMemberAdd', 'guildMemberRemove']) this.client.on(event, m => {
      schedule(async () => { if (relevant(m.guild.id)) await this.syncUser(m.id); });
    });
    this.client.on('guildDelete', guild => {
      if (guild.available === false) return;
      schedule(async () => {
        this.store.change(d => { for (const r of d.regiments.filter(r => r.guildId === guild.id && r.status === 'active')) { r.status = 'suspended'; r.syncError = 'Bot removed from source server; registration suspended.'; this.store.audit(d, 'server-removed', { guildId: guild.id }, { regimentId: r.id }); } });
        await this.sweep();
      });
    });
    this.client.on('roleDelete', role => { schedule(async () => { if (relevant(role.guild.id)) await this.sweep(); }); });
    this.client.once('ready', () => {
      schedule(async () => {
        const missing = this.store.read().regiments.filter(r => r.status === 'active' && !this.client.guilds.cache.has(r.guildId));
        if (missing.length) this.store.change(d => { for (const r of d.regiments.filter(r => missing.some(x => x.id === r.id))) { r.status = 'suspended'; this.store.audit(d, 'server-absent-at-restart', { guildId: r.guildId }, { regimentId: r.id }); } });
        await this.approvals.retry();
        await this.sweep();
      });
      this.timer = setInterval(() => { if (!this.periodicPending) { this.periodicPending = true; schedule(async () => { try { await this.approvals.retry(); await this.sweep(); } finally { this.periodicPending = false; } }); } }, 300000);
      this.timer.unref();
    });
  }
}
module.exports = { RegimentService, LOL_GUILD_ID, TARGET, errorText };



