 'use strict';
const { ActionRowBuilder, RoleSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { randomUUID } = require('node:crypto');
const COLORS = { info: 0x5865f2, success: 0x2ecc71, warning: 0xf1c40f, error: 0xe74c3c };
function card(title, description, tone = 'info', fields = []) {
  return { content: '', embeds: [{ title, description, color: COLORS[tone], fields, footer: { text: 'Quartermaster  |  Legion of Loyalists' } }], components: [], allowedMentions: { parse: [] } };
}
function response(value, title = 'Quartermaster') {
  if(typeof value !== 'string') return { content: '', components: [], ...value, allowedMentions: { parse: [] } };
  if(value.startsWith('Application submitted')) return card('Application submitted | Awaiting approval',value);
  if(value.startsWith('Your roles') || value.startsWith('Sync checked') || value.startsWith('Settings saved')) return card('Role synchronization result',value, /[1-9][0-9]* (failed|failures)/.test(value) ? 'warning' : 'success');
  return card(title,value);
}
function time(value) { return value ? `<t:${Math.floor(Date.parse(value) / 1000)}:f>` : 'Not recorded'; }
function status(r, activeSync) {
 const historic = r.syncError === 'Sync failed (Error). Check bot access, role hierarchy and server availability.';
 return card(`${r.name} ${r.tag}`, 'Registration, access mappings and synchronization health.', r.syncError ? 'warning' : 'info', [
  {name:'Registration', value:r.status.replaceAll('_',' '),inline:true},
  {name:'Leader',value:`<@${r.commanderId}>`,inline:true},
  {name:'Source server',value:r.guildId,inline:true},
  {name:'Member role',value:`<@&${r.memberRoleId}>\nID: ${r.memberRoleId}`,inline:true},
  {name:'Officer role',value:`<@&${r.officerRoleId}>\nID: ${r.officerRoleId}`,inline:true},
  {name:'Registered',value:time(r.registeredAt),inline:true},
  {name:'Regiment tag role',value:r.tagRoleProvision ? `${r.tagRoleId ? `<@&${r.tagRoleId}>` : 'Not created yet'} | ${r.tagRoleProvision.state}\n${r.tagRoleProvision.lastError || 'Automatic membership synchronization after approval.'}` : 'Existing registration; no automatic tag-role migration.'},
  {name:'Last successful full sync',value:time(r.lastSuccessfulSync),inline:true},
  {name:'Current sync',value:activeSync ? `${activeSync.completed}/${activeSync.total} members checked  |  ${activeSync.failed} failed` : 'No full sync running in this process.'},
  {name:'Sync health',value:historic ? 'Historical unclassified error from older code. A successful full sync has not been verified.' : r.syncError || 'No errors recorded.'},
  {name:'Admission vote',value:`${r.poll?.state || 'Existing registration'}\nDeadline: ${r.poll?.closesAt ? time(r.poll.closesAt) : 'Not started'}`}
 ]);
}
class RoleSessions {
 constructor(now = () => Date.now()) { this.sessions = new Map(); this.now = now; }
 start(i, data) {
  for (const [id,s] of this.sessions) if (s.expiresAt <= this.now()) this.sessions.delete(id);
  if (this.sessions.size >= 1000) throw new Error('Too many open setup sessions. Please try again later.');
  const session = { ...data, id: randomUUID(), ownerId: i.user.id, guildId: i.guildId, expiresAt: this.now()+10*60*1000 };
  this.sessions.set(session.id,session); return this.render(session);
 }
 get(i) {
  const [, , action, id] = i.customId.split(':'); const s=this.sessions.get(id);
  if (!s || s.expiresAt <= this.now()) { if(s)this.sessions.delete(id); throw new Error('This setup session expired or the bot restarted. Run the command again.'); }
  if(s.ownerId !== i.user.id || s.guildId !== i.guildId) throw new Error('Only the person who opened this setup can use it, in the original server.');
  if(!['member','officer','submit','cancel'].includes(action))throw new Error('Unknown setup action.');
  return {session:s,action};
 }
 render(s) {
  const result=card(s.mode==='create'?'Register your regiment':'Edit role mappings',`**${s.name} ${s.tag || ''}**\nChoose roles by name from this server. Discord supplies their IDs automatically. Nothing is saved until you confirm.\nThis private setup expires ${time(new Date(s.expiresAt).toISOString())}.`, 'info', [
   {name:'Member',value:s.memberRoleId?`<@&${s.memberRoleId}>`:'Choose a Member role',inline:true},
   {name:'Officer',value:s.officerRoleId?`<@&${s.officerRoleId}>`:'Choose an Officer role',inline:true},
   {name:s.mode==='create'?'What happens next':'After saving',value:s.mode==='create'?'Your application enters a 48-hour officer vote. No coalition roles are granted before approval.':'The mappings are saved and this regiment is resynchronized.'}
  ]);
  for(const key of ['member','officer']) {
   const menu=new RoleSelectMenuBuilder().setCustomId(`qm:setup:${key}:${s.id}`).setPlaceholder(`Choose the ${key === 'member'?'Member':'Officer'} role`).setMinValues(1).setMaxValues(1);
   // Do not populate default_values: a deleted saved role must not invalidate the menu itself.
   result.components.push(new ActionRowBuilder().addComponents(menu));
  }
  result.components.push(new ActionRowBuilder().addComponents(
   new ButtonBuilder().setCustomId(`qm:setup:submit:${s.id}`).setLabel(s.mode==='create'?'Submit application':'Save mappings and sync').setStyle(ButtonStyle.Success).setDisabled(!s.memberRoleId||!s.officerRoleId||s.memberRoleId===s.officerRoleId),
   new ButtonBuilder().setCustomId(`qm:setup:cancel:${s.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)));
  return result;
 }
 async handle(i, authorize, resolveRole, submit) {
  const {session:s,action}=this.get(i);
  if(action==='cancel'){this.sessions.delete(s.id);return card('Setup cancelled','No changes were saved.');}
  await authorize(s);
  if(action==='member'||action==='officer') {
   if(i.values?.length!==1)throw new Error('Choose exactly one role.');
   const role=await resolveRole(i.values[0]);
   const other=action==='member'?'officerRoleId':'memberRoleId';
   if(s[other]===role.id)throw new Error('Select different Member and Officer roles.');
   s[`${action}RoleId`]=role.id;return this.render(s);
  }
  if(!s.memberRoleId||!s.officerRoleId)throw new Error('Choose both roles before submitting.');
  const member=await resolveRole(s.memberRoleId),officer=await resolveRole(s.officerRoleId);
  if(member.id===officer.id)throw new Error('Select different Member and Officer roles.');
  // Consume before any external or storage mutation; an uncertain result must not be submitted twice.
  this.sessions.delete(s.id);
  return submit(s,member,officer);
 }
}
module.exports = { card, response, status, time, RoleSessions };
