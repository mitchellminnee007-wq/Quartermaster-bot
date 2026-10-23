'use strict';
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { createHash } = require('node:crypto');
const { DESTINATIONS, count } = require('./regimentVoting');
const LOL = '1521261614484033728';
const deliveries = new WeakMap();
function participation(poll, regiments = []) {
  const voters=new Set();let ballots=0,represented=0;const rows=[];
  for(const group of poll.electorate) {
    const entries=Object.entries(poll.officerBallots[group.regimentId] || {});
    const yes=entries.filter(([,b])=>b.choice==='yes').length,no=entries.filter(([,b])=>b.choice==='no').length;
    for(const [user] of entries)voters.add(user);
    ballots+=entries.length;if(entries.length)represented++;
    const label=regiments.find(r=>r.id===group.regimentId)?.tag || group.guildId;
    const provisional=yes>no?'yes leading':no>yes?'no leading':entries.length?'tie':'no votes';
    rows.push(`${label}: ${entries.length} voter(s) | ${yes} yes / ${no} no | ${provisional}`);
  }
  // Keep complete lines and an explicit overflow note within Discord's total embed budget.
  const fields=[];let chunk='',used=0,shown=0;
  for(const row of rows){if(used+row.length+1>3000)break;if(chunk.length+row.length+1>950){fields.push({name:'Votes by regiment',value:chunk,inline:false});chunk='';}chunk+=(chunk?'\n':'')+row;used+=row.length+1;shown++;}
  if(chunk)fields.push({name:'Votes by regiment',value:chunk,inline:false});
  if(shown<rows.length)fields.push({name:'Additional regiments',value:`${rows.length-shown} additional regiments are included in the totals; the detailed list exceeds Discord message limits.`,inline:false});
  return {voters:voters.size,ballots,represented,fields};
}
function payload(r, destinationId, regiments = []) {
  const poll = r.poll, tally = count(poll), officer = destinationId === poll.policy.officerChannelId;
  const open = poll.state === 'open' && poll.closesAt && Date.now() < Date.parse(poll.closesAt);
  const buttons = [];
  if (officer) for (const [choice, label, style] of [['yes', 'Vote yes', ButtonStyle.Success], ['no', 'Vote no', ButtonStyle.Secondary]]) buttons.push(new ButtonBuilder().setCustomId(`qm:ballot:${choice}:${r.id}`).setLabel(label).setStyle(style).setDisabled(!open));
  buttons.push(new ButtonBuilder().setCustomId(`qm:ballot:veto:${r.id}`).setLabel('Leader veto').setStyle(ButtonStyle.Danger).setDisabled(!open));
  const activity = participation(poll,regiments);
  return { embeds: [{ title: officer ? 'Regiment admission  |  Officer vote' : 'Regiment admission  |  Coalition overview', color: poll.state === 'rejected' ? 0xe74c3c : poll.state === 'approved' ? 0x2ecc71 : 0x5865f2, description: `**${r.name} ${r.tag}**\n${open ? 'Voting is open. No early acceptance.' : poll.state === 'open' ? 'Voting has ended. Finalization is pending.' : 'Admission status: '+poll.state.replaceAll('_',' ')}`, footer: { text: `Regiment poll ${r.id}` }, fields: [
    { name: 'Applicant', value: `<@${r.commanderId}>`, inline: true },
    { name: 'Source server', value: r.guildId, inline: true },
    { name: 'Deadline', value: poll.closesAt ? `<t:${Math.floor(Date.parse(poll.closesAt)/1000)}:F>\n<t:${Math.floor(Date.parse(poll.closesAt)/1000)}:R>` : 'The 48-hour window starts once both messages are delivered.' },
    { name: 'Voter participation', value: `${activity.voters} unique person(s) voted | ${activity.ballots} regiment ballot(s) recorded.\nA person representing multiple regiments counts once as a person and once per regiment ballot.` },
    { name: 'Regiment participation (not the final result)', value: `${activity.represented}/${tally.eligible} eligible regiments have received votes. Per-regiment yes/no leads below are provisional until the deadline.` },
    ...activity.fields,
    { name: 'Coalition result', value: `${tally.yes} yes  |  ${tally.no} no  |  ${tally.eligible} eligible regiments\nRequired: ${Math.floor(tally.eligible / 2) + 1} yes regiment votes. Outcomes are calculated after the deadline.` },
    { name: 'How admission works', value: '1. Officers vote during the 48-hour window.\n2. The majority of votes cast within each regiment becomes its single regiment vote. A tie or no votes produces no yes.\n3. More than 50% of ALL eligible regiments must vote yes. Abstaining regiments remain in this denominator.' },
    { name: 'Leader veto  |  immediate rejection', value: 'Only the current registered leader of an eligible regiment can veto while voting is open. The confirmation asks you to type VETO. A confirmed veto rejects the application immediately; administrators and officers have no override. Applicants cannot vote or veto their own admission, even as leader of another regiment.' }
  ] }], components: [new ActionRowBuilder().addComponents(buttons)], allowedMentions: { parse: [] } };
}
class VoteTransport {
  constructor({debounceMs=150}={}) { this.debounceMs=debounceMs; }
  async deliver(service,id,voting) {
    let pending=deliveries.get(service);if(!pending){pending=new Map();deliveries.set(service,pending);}
    const existing=pending.get(id);if(existing){existing.dirty=true;return existing.promise;}
    const job={dirty:false};pending.set(id,job);
    job.promise=(async()=>{try{let stale;do{job.dirty=false;await new Promise(resolve=>setTimeout(resolve,this.debounceMs));stale=await this.deliverOnce(service,id,voting);}while(job.dirty||stale);}finally{pending.delete(id);}})();
    return job.promise;
  }
  async deliverOnce(service, id, voting) {
    if (!voting.ready()) return;
    const { store, client } = service;
    const guild = client.guilds.cache.get(LOL);
    if (!guild || guild.available === false) throw new Error('Coalition unavailable.');
    let stale=false;
    // Two passes update the initially disabled cards after the second delivery opens the poll.
    for (let pass = 0; pass < 2; pass++) for (const destinationId of DESTINATIONS) {
      let r = store.read().regiments.find(r => r.id === id);
      if (!r?.poll?.messages) return;
      const saved = r.poll.messages[destinationId];
      if (saved?.messageId && saved.deliveredRevision === r.poll.revision && saved.presentationVersion === 4 && !saved.lastError && destinationId !== r.poll.policy.officerChannelId) continue;
      try {
        const destination = await guild.channels.fetch(destinationId);
        const expected = destinationId === r.poll.policy.officerChannelId ? ChannelType.GuildForum : ChannelType.GuildText;
        if (!destination || destination.guildId !== LOL || destination.type !== expected) throw new Error('Destination type or guild differs from the confirmed voting layout.');
        const required = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'];
        if (expected === ChannelType.GuildForum) required.push('SendMessagesInThreads', 'ManageThreads');
        if (!destination.permissionsFor(await guild.members.fetchMe())?.has(required)) throw new Error('Missing voting channel permissions.');
        let message, thread;
        if (saved?.messageId) {
          try {
            const channel = saved.channelId === destinationId ? destination : await guild.channels.fetch(saved.channelId);
            if (channel.isThread?.() && channel.archived && r.poll.state === 'open') await channel.setArchived(false, 'Keep the 48-hour officer vote accessible');
            message = await channel.messages.fetch(saved.messageId);
          } catch (e) {
            if (![10008, 10003].includes(e.code)) throw e;
            store.change(d => { delete d.regiments.find(x => x.id === id).poll.messages[destinationId]; store.audit(d, 'vote-message-missing', { guildId: LOL }, { regimentId: id, destinationId }); });
          }
        }
        const snapshot=store.read();r=snapshot.regiments.find(x=>x.id===id);if(!r?.poll)return false;
        const content = payload(r, destinationId,snapshot.regiments);
        const renderedRevision=r.poll.revision;
        if (!message && expected === ChannelType.GuildText) {
          const recent = await destination.messages.fetch({ limit: 100 });
          message = recent.find(m => m.author.id === client.user.id && m.embeds?.some(e => e.footer?.text === `Regiment poll ${id}`));
          if (!message) message = await destination.send({ ...content, nonce: createHash('sha256').update(`${id}:${destinationId}`).digest('hex').slice(0, 24), enforceNonce: true });
        } else if (!message) {
          const name = `Admission ${r.tag} ${id}`;
          const active = await destination.threads.fetchActive();
          thread = active.threads.find(t => t.name === name && t.ownerId === client.user.id);
          if (!thread) {
            const archived = await destination.threads.fetchArchived({ limit: 100 });
            thread = archived.threads.find(t => t.name === name && t.ownerId === client.user.id);
          }
          if (!thread) thread = await destination.threads.create({ name, message: content, autoArchiveDuration: 1440, reason: 'Requested regiment admission officer vote' });
          message = await thread.fetchStarterMessage();
        }
        if (!message) throw new Error('Voting message unavailable.');
        await message.edit(content);
        voting.recordMessage(id, destinationId, message.channelId || thread?.id || destinationId, message.id, renderedRevision);
        if(store.read().regiments.find(x=>x.id===id)?.poll.revision!==renderedRevision)stale=true;
        store.change(d => { const current=d.regiments.find(x=>x.id===id); if(current?.poll?.messages[destinationId]?.messageId===message.id) current.poll.messages[destinationId].presentationVersion=4; });
      } catch (e) {
        store.change(d => {
          const current = d.regiments.find(x => x.id === id); if (!current?.poll) return;
          const error = e.code ? `Discord error ${e.code}` : e.message;
          current.poll.messages[destinationId] = { ...current.poll.messages[destinationId], lastError: error };
          store.audit(d, 'vote-publication-failed', { guildId: LOL }, { regimentId: id, destinationId, error });
        });
      }
    }
    try { await require('./regimentOfficerNotice').notifyOfficers(service,id); }
    catch { store.log('officer-notification-check-failed',{guildId:LOL},{regimentId:id}); }
    return stale;
  }
}
module.exports = { VoteTransport, payload, participation };
