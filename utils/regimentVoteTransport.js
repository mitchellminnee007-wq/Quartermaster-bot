'use strict';
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { createHash } = require('node:crypto');
const { DESTINATIONS, count } = require('./regimentVoting');
const LOL = '1521261614484033728';
function payload(r, destinationId) {
  const poll = r.poll, tally = count(poll), officer = destinationId === poll.policy.officerChannelId;
  const open = poll.state === 'open' && poll.closesAt && Date.now() < Date.parse(poll.closesAt);
  const buttons = [];
  if (officer) for (const [choice, label, style] of [['yes', 'Officer: ja', ButtonStyle.Success], ['no', 'Officer: nee', ButtonStyle.Secondary]]) buttons.push(new ButtonBuilder().setCustomId(`qm:ballot:${choice}:${r.id}`).setLabel(label).setStyle(style).setDisabled(!open));
  buttons.push(new ButtonBuilder().setCustomId(`qm:ballot:veto:${r.id}`).setLabel('Leader veto').setStyle(ButtonStyle.Danger).setDisabled(!open));
  return { embeds: [{ title: officer ? 'Officerstemming: toelating regiment' : 'Coalitieoverzicht: toelating regiment', description: `${r.name} [${r.tag}]`, footer: { text: `Regiment poll ${r.id}` }, fields: [
    { name: 'Aanvrager / server', value: `${r.commanderId} / ${r.guildId}` },
    { name: 'Status', value: poll.state },
    { name: 'Deadline (UTC)', value: poll.closesAt || 'Start zodra beide berichten zijn geplaatst' },
    { name: 'Regimentsstemmen', value: `${tally.yes} ja / ${tally.no} nee; ${tally.eligible} aangesloten regimenten. Vereist: ${Math.floor(tally.eligible / 2) + 1} ja.` },
    { name: 'Regels', value: 'Eén persoonlijke officerstem per vertegenwoordigd regiment. Na de termijn bepaalt de interne meerderheid één regimentsstem. Gelijkspel/geen stemmen is geen ja. Alleen de geregistreerde leader kan tijdens de open stemming een direct afwijzend veto geven.' }
  ] }], components: [new ActionRowBuilder().addComponents(buttons)], allowedMentions: { parse: [] } };
}
class VoteTransport {
  async deliver(service, id, voting) {
    if (!voting.ready()) return;
    const { store, client } = service;
    const guild = client.guilds.cache.get(LOL);
    if (!guild || guild.available === false) throw new Error('Coalition unavailable.');
    // Two passes update the initially disabled cards after the second delivery opens the poll.
    for (let pass = 0; pass < 2; pass++) for (const destinationId of DESTINATIONS) {
      let r = store.read().regiments.find(r => r.id === id);
      if (!r?.poll?.messages) return;
      const saved = r.poll.messages[destinationId];
      if (saved?.messageId && saved.deliveredRevision === r.poll.revision && !saved.lastError && destinationId !== r.poll.policy.officerChannelId) continue;
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
        const content = payload(r, destinationId);
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
        voting.recordMessage(id, destinationId, message.channelId || thread?.id || destinationId, message.id);
      } catch (e) {
        store.change(d => {
          const current = d.regiments.find(x => x.id === id); if (!current?.poll) return;
          const error = e.code ? `Discord error ${e.code}` : e.message;
          current.poll.messages[destinationId] = { ...current.poll.messages[destinationId], lastError: error };
          store.audit(d, 'vote-publication-failed', { guildId: LOL }, { regimentId: id, destinationId, error });
        });
      }
    }
  }
}
module.exports = { VoteTransport, payload };
