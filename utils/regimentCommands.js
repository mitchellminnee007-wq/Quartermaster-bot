'use strict';
const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { RegimentService, LOL_GUILD_ID, errorText } = require('./regimentSync');
const { ROLE_IDS } = require('./roleIds');
const { norm } = require('./regimentStore');
const services = new WeakMap();
function service(client) {
  if (!services.has(client)) { const s = new RegimentService(client); services.set(client, s); s.init(); }
  return services.get(client);
}
const actor = i => ({ userId: i.user.id, guildId: i.guildId });
async function admin(i) {
  const guild = i.client.guilds.cache.get(LOL_GUILD_ID);
  if (!guild) return false;
  let member;
  try { member = await guild.members.fetch({ user: i.user.id, force: true }); }
  catch (e) { if (e.code === 10007) return false; throw e; }
  return member.permissions.has(PermissionFlagsBits.Administrator) || member.roles.cache.has(ROLE_IDS.BOT_ADMIN_ROLE_ID);
}
async function manage(i) {
  const member = await i.guild.members.fetch({ user: i.user.id, force: true });
  return member.permissions.has(PermissionFlagsBits.ManageGuild);
}
async function requireAccess(i, allowed) {
  if (!allowed) { service(i.client).store.log('unauthorized-command', actor(i), { command: i.commandName || i.customId }); throw new Error('You are not authorized for this action.'); }
}
function selected(s, i, requestedName) {
  const name = requestedName || i.options?.getString('name');
  const r = [...s.store.read().regiments].reverse().find(r => name ? norm(r.name) === norm(name) : r.guildId === i.guildId);
  if (!r) throw new Error('Regiment not found. Use its exact name in LOL or run this in the regiment server.');
  return r;
}
async function canEdit(i, r) { return r.commanderId === i.user.id || await admin(i); }
async function mappings(i, member, officer) {
  if (member.id === officer.id) throw new Error('Select different Member and Officer roles.');
  for (const role of [member, officer]) {
    const fresh = await i.guild.roles.fetch(role.id);
    if (!fresh || fresh.guild.id !== i.guildId || fresh.id === i.guildId || fresh.managed) throw new Error('Select ordinary roles from this regiment server; everyone and managed roles are not allowed.');
  }
}
function panel() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('qm:user').setLabel('User Role Sync').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('qm:regiment').setLabel('Regiment Role Sync').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('qm:coalition').setLabel('Coalition Role Sync').setStyle(ButtonStyle.Danger));
}
function progressReply(i) {
  let last = 0;
  return async p => {
    if (Date.now() - last < 10000 && p.completed !== p.total) return;
    last = Date.now();
    await i.editReply({ content: `Role sync in progress: ${p.completed}/${p.total} LOL members checked; ${p.failed} failed. Please do not start another sync.`, allowedMentions: { parse: [] } });
  };
}
async function manual(i, mode, requestedName) {
  const s = service(i.client);
  let r;
  if (mode === 'coalition') await requireAccess(i, i.guildId === LOL_GUILD_ID && await admin(i));
  else if (mode === 'regiment') { r = selected(s, i, requestedName); await requireAccess(i, await canEdit(i, r) || (i.guildId === r.guildId && await manage(i))); }
  else if (mode !== 'user') throw new Error('Invalid synchronization scope');
  if (r && r.status !== 'active') throw new Error('Only approved active regiments can be synchronized.');
  s.store.log('manual-sync', actor(i), { scope: mode, regimentId: r?.id || null });
  if (mode === 'user') { await s.syncUser(i.user.id); return 'Your roles have been reconciled. Roles can only be assigned while you are a member of LOL.'; }
  const result = await s.sweep(actor(i), r?.id, progressReply(i));
  return `Sync checked ${result.users} coalition users; ${result.failed} failed. Failures are audited and retried. Coalition Role Sync is intended once per war; no artificial limit is imposed.`;
}
async function info(i) {
  const category = i.options.getString('category');
  if (category === 'getting-started') return 'Quartermaster setup: use /invite for the existing bot invite. Add the bot to your regiment and ensure its existing Guild Members intent is enabled. Create separate Member and Officer roles, then use /create-regiment name:Name tag:TAG member:role officer:role (Manage Server required). New applications require a 48-hour officer vote before any LOL roles or regiment sync. Each regiment gets one result from its individual officer ballots; more than half of all eligible regiments must say yes. Only registered leaders may veto during the open vote. Join Legion of Loyalists (LOL): https://discord.gg/8ew5AEq5x9 . Contact @BravoMike185 if you need help joining. In <#1563207553687748779> use /rolesync: User Role Sync for yourself, Regiment Role Sync for your regiment (commander, server manager or coalition admin), or Coalition Role Sync (coalition admins, intended once per war). /rolesync displays the same three controls.';
  if (category === 'lol') return 'Legion of Loyalists (LOL) is a Colonial Loyalist coalition. Regiments keep independent leadership. There are no compulsory coalition operations and no central coalition facility. Members cooperate while Quartermaster connects regiment membership and leadership to coalition access.';
  const help = [
    '**Regiment server:** /create-regiment requires Manage Server; select Member and Officer roles and await democratic regiment approval. /regiment-settings reads settings for everyone; changes/resync require commander or coalition admin (mapping changes in source server). /delete-regiment requires commander or coalition admin and exact ACCEPT. /regiment-status shows health (name can select a regiment from LOL).',
    '**#rolesync or /rolesync:** User Role Sync = self only. Regiment Role Sync = commander, source-server Manage Server or coalition admin; in LOL supply name. Coalition Role Sync = coalition admins in LOL, intended once per war. /info and /invite are informational.',
    '**Existing commands, in their configured server:** /promote = officers/admins, recruitment officers limited to initial recruitment; /demote and /discharge = officers/admins with existing rank restrictions; /promoteally = officers. /warning and /warningstatus = officers; warning votes use existing officer controls.',
    '/activitycheck and /clearactivitycheck = officers; /activitycheckroster = members; Mark Active button toggles yourself. /killcount add = members/officers; start, remove, reset, end = officers. /startrollover and /cancelrollover = officers.',
    '/operation and /training = Manage Server visibility plus officer checks; members join/leave via buttons, creators/officers manage events. /reactionrole setup = Manage Server plus officer check; role buttons toggle yourself. /botpanel = Manage Server plus officers. /ticketpanel = Manage Server; members open tickets, recruitment officers process them. /config = Manage Server; sets channels, roles and welcome image or views settings.',
    'Automatic features: welcome, allied verification, leaving notices, warning expiry, event panels and rollover retain their existing behavior. Regiment sync adds role-change/join/leave handling and recovery retries. Join LOL: https://discord.gg/8ew5AEq5x9 . Contact @BravoMike185 for help.'
  ];
  return { embeds: [{ title: 'Quartermaster commands and permissions', description: help.join('\n\n'), color: 0x5865F2 }] };
}
async function executeRaw(i) {
  const s = service(i.client), command = i.commandName;
  if (!i.guildId) throw new Error('Use this command in a server.');
  if (command === 'info') return info(i);
  if (command === 'create-regiment') {
    await requireAccess(i, i.guildId !== LOL_GUILD_ID && await manage(i));
    const member = i.options.getRole('member', true), officer = i.options.getRole('officer', true);
    await mappings(i, member, officer);
    const r = s.store.create({ name: i.options.getString('name', true), tag: i.options.getString('tag', true), guildId: i.guildId, commanderId: i.user.id, memberRoleId: member.id, officerRoleId: officer.id }, actor(i));
    await s.approvals.deliver(r.id);
    const current = s.store.read().regiments.find(x => x.id === r.id);
    return `Application submitted for ${r.name} [${r.tag}]. Awaiting democratic regiment admission; no LOL roles are granted by this application. ${current.poll?.state === 'bootstrap_required' ? 'No approved founding regiments exist. Coalition founding registrations must be explicitly established before a vote can open.' : current.poll?.openedAt ? 'Officer voting has opened for 48 hours.' : 'Voting publication is pending and will retry automatically; check /regiment-status.'}`;
  }
  if (command === 'rolesync') {
    const scope = i.options.getString('scope');
    if (!scope) return { content: 'Choose a role synchronization scope. Coalition sync is intended once per war.', components: [panel()] };
    return manual(i, scope);
  }
  const r = selected(s, i);
  if (command === 'regiment-settings') {
    const member = i.options.getRole('member'), officer = i.options.getRole('officer');
    if (member || officer || i.options.getBoolean('resync')) {
      await requireAccess(i, await canEdit(i, r));
      if (['pending_approval', 'rejected'].includes(r.status)) throw new Error('Application is not approved. Pending mappings cannot change; withdraw and submit a new application to correct them. Rejected applications may be resubmitted with /create-regiment.');
      if (r.status === 'deleting') throw new Error('Regiment deletion is pending.');
      if (r.status === 'suspended') {
        await requireAccess(i, i.guildId === r.guildId && await manage(i));
        const guild = await s.guild(r.guildId);
        if (!await guild.roles.fetch(r.memberRoleId) || !await guild.roles.fetch(r.officerRoleId)) throw new Error('Restore the mapped source roles before reactivation.');
        s.store.change(d => { d.regiments.find(x => x.id === r.id).status = 'active'; s.store.audit(d, 'registration-resumed', actor(i), { regimentId: r.id }); });
      }
      if (member || officer) {
        await requireAccess(i, i.guildId === r.guildId);
        const mr = member || await i.guild.roles.fetch(r.memberRoleId), or = officer || await i.guild.roles.fetch(r.officerRoleId);
        if (!mr || !or) throw new Error('Both mappings must point to existing roles.');
        await mappings(i, mr, or);
        s.store.change(d => { const current = d.regiments.find(x => x.id === r.id); current.legacyCompatibility = false; current.memberRoleId = mr.id; current.officerRoleId = or.id; s.store.audit(d, 'mapping-change', actor(i), { regimentId: r.id, previous: { member: r.memberRoleId, officer: r.officerRoleId }, next: { member: mr.id, officer: or.id } }); });
      }
      s.store.log('manual-sync', actor(i), { scope: 'settings', regimentId: r.id });
      const result = await s.sweep(actor(i), r.id, progressReply(i));
      return `Settings saved; sync checked ${result.users} users, ${result.failed} failures.`;
    }
  }
  return `Regiment: ${r.name} [${r.tag}]\nID: ${r.id}\nStatus: ${r.status}\nCommander: <@${r.commanderId}>\nServer: ${r.guildId}\nMember mapping: ${r.memberRoleId}\nOfficer mapping: ${r.officerRoleId}\nRegistered: ${r.registeredAt}\nCurrent sync: ${s.activeSync ? `${s.activeSync.completed}/${s.activeSync.total} members checked, ${s.activeSync.failed} failed` : 'No full sync running in this process'}\nLast successful full sync: ${r.lastSuccessfulSync || 'Never'}\nSync errors: ${r.syncError === 'Sync failed (Error). Check bot access, role hierarchy and server availability.' ? 'Historical unclassified error: older code also recorded command failures here. A successful full sync has not been verified.' : r.syncError || 'None recorded'}\nApproval: ${r.review ? `${r.review.decision} by ${r.review.userId} at ${r.review.timestamp}` : r.status === 'pending_approval' ? 'Awaiting regiment vote' : 'Existing registration'}\nVote status: ${r.poll?.state || 'Existing registration'}\nVote deadline (UTC): ${r.poll?.closesAt || 'Not started'}`;
}
async function decideApproval() { throw new Error('Direct admin approval is disabled. Admission requires the 48-hour two-level regiment vote.'); }
async function voteButton(i, s) {
  const [, , choice, id] = i.customId.split(':');
  const r = s.store.read().regiments.find(r => r.id === id);
  const voting = s.approvals.voting;
  voting.assertOrigin(r, { guildId: i.guildId, channelId: i.channelId, messageId: i.message.id }, choice);
  if (r.status !== 'pending_approval' || r.poll.state !== 'open') throw new Error('This poll is closed.');
  const eligible = await voting.eligible(i.user.id, r, choice);
  await requireAccess(i, eligible.length > 0);
  const input = new TextInputBuilder().setCustomId('regiment-name').setLabel('Exact name of the regiment you represent').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80);
  if (eligible.length === 1) input.setValue(eligible[0].name);
  await i.showModal(new ModalBuilder().setCustomId(`qm:cast:${choice}:${id}:${i.channelId}:${i.message.id}`).setTitle(choice === 'veto' ? 'Regiment leader veto' : 'Individual officer ballot').addComponents(new ActionRowBuilder().addComponents(input)));
}
async function voteModal(i, s) {
  const [, , choice, id, channelId, messageId] = i.customId.split(':');
  await requireAccess(i, i.channelId === channelId);
  const result = await s.approvals.voting.cast(id, i.fields.getTextInputValue('regiment-name'), choice, actor(i), { guildId: i.guildId, channelId, messageId });
  await s.approvals.deliver(id);
  return result.changed ? result.status === 'rejected' ? 'Leader veto recorded: application rejected immediately.' : 'Your individual officer ballot is recorded. Regiment outcomes are calculated after the deadline.' : result.reason || 'Poll already decided; no change made.';
}
async function execute(i) {
  const s = service(i.client);
  if (i.commandName === 'delete-regiment') {
    try {
      await s.run(async () => {
        const r = selected(s, i); await requireAccess(i, await canEdit(i, r));
        const input = new TextInputBuilder().setCustomId('confirmation').setLabel('Type ACCEPT to delete this regiment').setStyle(TextInputStyle.Short).setRequired(true);
        const modal = new ModalBuilder().setCustomId(`qm:delete:${r.id}`).setTitle('Delete regiment').addComponents(new ActionRowBuilder().addComponents(input));
        await i.showModal(modal);
      });
    } catch (e) { await i.reply({ content: e.message, ephemeral: true, allowedMentions: { parse: [] } }); }
    return;
  }
  await i.deferReply({ ephemeral: true });
  try { const result = await (['regiment-status', 'info'].includes(i.commandName) ? executeRaw(i) : s.run(() => executeRaw(i))); await i.editReply({ ...(typeof result === 'string' ? { content: result } : result), allowedMentions: { parse: [] } }); }
  catch (e) { s.reportCommand(e, actor(i), i.commandName || i.customId); await i.editReply({ content: e.code ? errorText(e) : e.message, allowedMentions: { parse: [] } }); }
}
function init(client) {
  service(client);
  client.on('interactionCreate', async i => {
    if (!i.customId?.startsWith('qm:')) return;
    if (i.isButton() && i.customId.startsWith('qm:ballot:')) {
      try { await service(client).run(() => voteButton(i, service(client))); }
      catch (e) { service(client).store.log('vote-interaction-error', actor(i), { error: e.code ? errorText(e) : e.message }); await i.reply({ content: e.code ? errorText(e) : e.message, ephemeral: true, allowedMentions: { parse: [] } }); }
      return;
    }
    if (i.isButton() && i.customId === 'qm:regiment') {
      try {
        const input = new TextInputBuilder().setCustomId('regiment-name').setLabel('Registered regiment name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80);
        await i.showModal(new ModalBuilder().setCustomId('qm:regiment-select').setTitle('Regiment Role Sync').addComponents(new ActionRowBuilder().addComponents(input)));
      } catch (e) { service(client).reportCommand(e, actor(i), i.commandName || i.customId); }
      return;
    }
    await i.deferReply({ ephemeral: true });
    const s = service(client);
    try {
      const result = await s.run(async () => {
        if (i.isModalSubmit() && i.customId.startsWith('qm:cast:')) return voteModal(i, s);
        if (i.isButton() && i.customId.startsWith('qm:approval:')) return decideApproval(i, s);
        if (i.isModalSubmit() && i.customId === 'qm:regiment-select') return manual(i, 'regiment', i.fields.getTextInputValue('regiment-name'));
        if (i.isModalSubmit() && i.customId.startsWith('qm:delete:')) {
          const id = i.customId.slice('qm:delete:'.length);
          const r = s.store.read().regiments.find(r => r.id === id);
          if (!r) throw new Error('Regiment already deleted or does not exist.');
          await requireAccess(i, await canEdit(i, r));
          if (i.fields.getTextInputValue('confirmation') !== 'ACCEPT') throw new Error('Deletion cancelled: confirmation must be exactly ACCEPT.');
          const result = await s.remove(id, actor(i));
          return result.failed ? `Deletion pending: ${result.failed} sync failures. Registration is disabled and cleanup will retry.` : 'Regiment deleted; other regiment entitlements were preserved.';
        }
        if (i.isButton()) return manual(i, i.customId.slice(3));
        throw new Error('Unsupported control.');
      });
      await i.editReply({ content: result, allowedMentions: { parse: [] } });
    } catch (e) { s.reportCommand(e, actor(i), i.commandName || i.customId); await i.editReply({ content: e.code ? errorText(e) : e.message, allowedMentions: { parse: [] } }); }
  });
}
function definition(name) {
  const b = new SlashCommandBuilder().setName(name).setDescription({ 'create-regiment': 'Register this regiment server with LOL.', 'delete-regiment': 'Delete a regiment after explicit confirmation.', 'regiment-settings': 'Show or update regiment role mappings.', 'regiment-status': 'Show registration and synchronization health.', rolesync: 'Open role sync controls or run a sync.', info: 'Learn about Quartermaster and the coalition.' }[name]).setDMPermission(false);
  if (name === 'create-regiment') {
    b.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addStringOption(o => o.setName('name').setDescription('Unique regiment name').setMaxLength(80).setRequired(true)).addStringOption(o => o.setName('tag').setDescription('Unique regiment tag').setMaxLength(16).setRequired(true));
    for (const role of ['member', 'officer']) b.addRoleOption(o => o.setName(role).setDescription(`${role} role in this server`).setRequired(true));
  }
  if (['delete-regiment', 'regiment-status', 'regiment-settings', 'rolesync'].includes(name)) b.addStringOption(o => o.setName('name').setDescription('Regiment name; defaults to this server').setRequired(name === 'delete-regiment'));
  if (name === 'regiment-settings') { for (const role of ['member', 'officer']) b.addRoleOption(o => o.setName(role).setDescription(`New ${role} role`)); b.addBooleanOption(o => o.setName('resync').setDescription('Resynchronize after saving')); }
  if (name === 'rolesync') b.addStringOption(o => o.setName('scope').setDescription('Sync scope').addChoices({ name: 'User Role Sync', value: 'user' }, { name: 'Regiment Role Sync', value: 'regiment' }, { name: 'Coalition Role Sync', value: 'coalition' }));
  if (name === 'info') b.addStringOption(o => o.setName('category').setDescription('Information category').setRequired(true).addChoices({ name: 'Getting Started', value: 'getting-started' }, { name: 'LOL', value: 'lol' }, { name: 'Commands', value: 'commands' }));
  return b;
}
module.exports = { execute, init, definition, service, admin, manage, requireAccess, manual, decideApproval, voteButton, voteModal };


