'use strict';
const { getConfig } = require('./config');
const { norm } = require('./regimentStore');
const LOL = '1521261614484033728';
const DESTINATIONS = ['1563235001120858122', '1521502333312434288'];
const BLOCKED_POLICY = Object.freeze({ enabled: false, confirmed: false, internalMajority: 'cast_at_deadline', durationMs: null, officerChannelId: '1521502333312434288', overviewChannelId: '1563235001120858122' });
const CONFIRMED_POLICY = Object.freeze({ enabled: true, confirmed: true, internalMajority: 'cast_at_deadline', durationMs: 48 * 60 * 60 * 1000, officerChannelId: '1521502333312434288', overviewChannelId: '1563235001120858122' });
function configuredPolicy() {
  const raw = getConfig(LOL, 'REGIMENT_VOTE_POLICY');
  if (!raw) return CONFIRMED_POLICY;
  try { return JSON.parse(raw); } catch { return BLOCKED_POLICY; }
}
function validPolicy(p) {
  return p?.enabled === true && p.confirmed === true && p.internalMajority === 'cast_at_deadline'
    && p.officerChannelId === '1521502333312434288' && p.overviewChannelId === '1563235001120858122'
    && Number.isSafeInteger(p.durationMs) && p.durationMs >= 60000;
}
function regimentResults(poll, now = Date.now()) {
  const results = {};
  for (const group of poll.electorate) {
    const ballots = Object.values(poll.officerBallots[group.regimentId] || {});
    const yes = ballots.filter(b => b.choice === 'yes').length;
    const no = ballots.filter(b => b.choice === 'no').length;
    let outcome = null;
    if (poll.policy.internalMajority === 'all_officers') {
      if (yes > group.officerIds.length / 2) outcome = 'yes';
      else if (no > group.officerIds.length / 2) outcome = 'no';
    } else if (poll.closesAt && now >= Date.parse(poll.closesAt) && ballots.length >= 1) {
      if (yes > ballots.length / 2) outcome = 'yes';
      else if (no > ballots.length / 2) outcome = 'no';
    }
    results[group.regimentId] = { yes, no, total: ballots.length, eligible: group.officerIds.length, outcome };
  }
  return results;
}
function count(poll, now) {
  const results = Object.values(regimentResults(poll, now));
  return { yes: results.filter(r => r.outcome === 'yes').length, no: results.filter(r => r.outcome === 'no').length, eligible: poll.electorate.length, internal: regimentResults(poll, now) };
}
function evaluate(poll, now = Date.now()) {
  if (!validPolicy(poll.policy) || !poll.openedAt || !poll.closesAt || now < Date.parse(poll.closesAt)) return null;
  const tally = count(poll, now);
  return tally.eligible > 0 && tally.yes > tally.eligible / 2 ? 'approved' : 'rejected';
}
class RegimentVoting {
  constructor(service, policy = configuredPolicy) { this.service = service; this.policy = policy; }
  ready() { return validPolicy(this.policy()); }
  async prepare(id) {
    const policy = this.policy(), { store, client } = this.service;
    if (!validPolicy(policy)) return false;
    const data = store.read(), application = data.regiments.find(r => r.id === id);
    if (!application || application.status !== 'pending_approval') return false;
    if (application.poll && !['policy_pending', 'bootstrap_required'].includes(application.poll.state)) return true;
    const electorate = [];
    for (const r of data.regiments.filter(r => r.status === 'active' && r.id !== id && r.guildId !== application.guildId)) {
      const guild = client.guilds.cache.get(r.guildId);
      if (!guild || guild.available === false) throw new Error('Cannot snapshot an unavailable regiment.');
      const role = await guild.roles.fetch(r.officerRoleId);
      if (!role || role.managed || role.id === guild.id) throw new Error('Cannot snapshot an invalid Officer mapping.');
      const members = await guild.members.fetch();
      electorate.push({ regimentId: r.id, guildId: r.guildId, officerIds: [...members.values()].filter(m => !m.user?.bot && m.roles.cache.has(role.id)).map(m => m.id) });
    }
    store.change(d => {
      const r = d.regiments.find(r => r.id === id);
      if (!r || r.status !== 'pending_approval' || (r.poll && !['policy_pending', 'bootstrap_required'].includes(r.poll.state))) return;
      r.poll = { ...(r.poll?.officerNotice ? { officerNotice: r.poll.officerNotice } : {}), version: 2, revision: 0, state: electorate.length ? 'publishing' : 'bootstrap_required', policy: structuredClone(policy), electorate, officerBallots: {}, messages: {}, openedAt: null, closesAt: null };
      store.audit(d, 'regiment-poll-created', { guildId: LOL }, { regimentId: id, electorate });
    });
    return electorate.length > 0;
  }
  recordMessage(id, destinationId, channelId, messageId, renderedRevision) {
    this.service.store.change(d => {
      const r = d.regiments.find(r => r.id === id);
      if (!this.ready() || !validPolicy(r?.poll?.policy) || !DESTINATIONS.includes(destinationId)) throw new Error('Voting policy or destination is not confirmed.');
      const previous = r.poll.messages[destinationId];
      if (previous?.messageId && (previous.messageId !== messageId || previous.channelId !== channelId)) throw new Error('Voting destination already bound to another message.');
      r.poll.messages[destinationId] = { ...previous, channelId, messageId, deliveredRevision: renderedRevision ?? r.poll.revision, lastError: null };
      if (!r.poll.openedAt && DESTINATIONS.every(key => r.poll.messages[key]?.messageId)) {
        r.poll.openedAt = new Date().toISOString(); r.poll.state = 'open'; r.poll.revision++;
        if (r.poll.policy.internalMajority === 'cast_at_deadline') r.poll.closesAt = new Date(Date.parse(r.poll.openedAt) + r.poll.policy.durationMs).toISOString();
        this.service.store.audit(d, 'regiment-poll-opened', { guildId: LOL }, { regimentId: id });
      }
    });
  }
  assertOrigin(r, origin, choice) {
    if (!this.ready() || !r?.poll || !validPolicy(r.poll.policy)) throw new Error('Voting policy is not confirmed; voting and publication are disabled.');
    const destinations = choice === 'veto' ? DESTINATIONS : [r.poll.policy.officerChannelId];
    if (origin.guildId !== LOL || !destinations.some(id => r.poll.messages[id]?.channelId === origin.channelId && r.poll.messages[id]?.messageId === origin.messageId)) throw new Error('Unrecognized voting message or wrong voting stage.');
    if (!DESTINATIONS.every(id => r.poll.messages[id]?.messageId) || !r.poll.openedAt) throw new Error('Both voting messages must be delivered before voting opens.');
  }
  async eligible(userId, application, choice) {
    if (userId === application.commanderId) return []; // An applicant cannot influence its own admission through another membership.
    const { client, store } = this.service;
    const coalition = client.guilds.cache.get(LOL);
    if (!coalition || coalition.available === false) throw new Error('Coalition unavailable.');
    await coalition.members.fetch({ user: userId, force: true });
    const eligible = [];
    for (const r of store.read().regiments.filter(r => r.status === 'active' && application.poll.electorate.some(e => e.regimentId === r.id) && r.guildId !== application.guildId)) {
      const group = application.poll.electorate.find(e => e.regimentId === r.id);
      const guild = client.guilds.cache.get(r.guildId);
      if (!guild || guild.available === false) continue;
      try {
        const member = await guild.members.fetch({ user: userId, force: true });
        if (choice === 'veto') { if (r.commanderId === userId) eligible.push(r); continue; }
        const officer = await guild.roles.fetch(r.officerRoleId);
        if (group.officerIds.includes(userId) && officer && !officer.managed && officer.id !== guild.id && member.roles.cache.has(officer.id)) eligible.push(r);
      } catch (e) { if (e.code !== 10007) throw e; }
    }
    return eligible;
  }
  finalize(d, r, outcome, actor, reason) {
    r.status = outcome === 'approved' ? 'active' : 'rejected'; r.poll.state = outcome; r.poll.revision++;
    if (outcome === 'approved') r.tagRoleProvision = { enabled: true, state: 'pending' };
    r.review = { decision: outcome, userId: actor.userId || null, guildId: actor.guildId || LOL, timestamp: new Date().toISOString(), reason };
    this.service.store.audit(d, `regiment-vote-${outcome}`, actor, { regimentId: r.id, reason, tally: count(r.poll) });
  }
  async cast(id, selectedName, choice, actor, origin) {
    const { store } = this.service;
    const current = store.read().regiments.find(r => r.id === id);
    this.assertOrigin(current, origin, choice);
    if (!['yes', 'no', 'veto'].includes(choice)) throw new Error('Invalid ballot.');
    if (current.poll.state !== 'open' || current.status !== 'pending_approval') return { changed: false, status: current.status };
    if (current.poll.closesAt && Date.now() >= Date.parse(current.poll.closesAt)) throw new Error('The internal voting window has ended.');
    const eligible = await this.eligible(actor.userId, current, choice);
    const voter = eligible.find(r => r.id === selectedName || norm(r.name) === norm(selectedName));
    if (!voter) {
      store.log('unauthorized-vote', actor, { regimentId: id, choice });
      throw new Error(choice === 'veto' ? 'Only the current registered regiment leader may veto.' : 'Select a regiment in whose officer electorate you are included and whose current Officer role you hold.');
    }
    return store.change(d => {
      const r = d.regiments.find(x => x.id === id);
      if (!r || r.status !== 'pending_approval' || r.poll.state !== 'open') return { changed: false, status: r?.status };
      if (!d.regiments.some(x => x.id === voter.id && x.status === 'active')) throw new Error('Voting regiment is no longer active.');
      const ballots = r.poll.officerBallots[voter.id] || {};
      if (choice !== 'veto' && ballots[actor.userId]) return { changed: false, status: r.status, reason: 'Your individual officer ballot for this regiment is already recorded.' };
      const ballot = { choice, userId: actor.userId, guildId: actor.guildId, timestamp: new Date().toISOString() };
      if (choice === 'veto') {
        r.poll.veto = { ...ballot, regimentId: voter.id }; this.finalize(d, r, 'rejected', actor, 'leader-veto');
      } else {
        r.poll.officerBallots[voter.id] = { ...ballots, [actor.userId]: ballot }; r.poll.revision++;
        const outcome = evaluate(r.poll); if (outcome) this.finalize(d, r, outcome, actor, 'majority-of-regiments');
      }
      store.audit(d, 'regiment-officer-ballot', actor, { regimentId: id, votingRegimentId: voter.id, choice });
      return { changed: true, status: r.status, tally: count(r.poll) };
    });
  }
  closeDue() {
    if (!this.ready()) return;
    const due = this.service.store.read().regiments.filter(r => r.status === 'pending_approval' && r.poll?.state === 'open' && r.poll.closesAt && Date.now() >= Date.parse(r.poll.closesAt));
    if (!due.length) return;
    this.service.store.change(d => { for (const r of d.regiments.filter(r => due.some(x => x.id === r.id))) { const outcome = evaluate(r.poll); if (outcome) this.finalize(d, r, outcome, { guildId: LOL }, 'majority-of-regiments'); } });
  }
}
module.exports = { RegimentVoting, DESTINATIONS, BLOCKED_POLICY, CONFIRMED_POLICY, validPolicy, count, evaluate, regimentResults };
