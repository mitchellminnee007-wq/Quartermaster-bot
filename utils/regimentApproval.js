'use strict';
// Finalize voting and retry durable provisioning before normal role reconciliation.
const { RegimentVoting } = require('./regimentVoting');
class ApprovalNotifications {
  constructor(service, policy, transport = new (require('./regimentVoteTransport').VoteTransport)()) { this.service = service; this.voting = new RegimentVoting(service, policy); this.transport = transport; }
  async deliver(id) {
    if (!this.voting.ready()) return;
    const r = this.service.store.read().regiments.find(r => r.id === id);
    if (r?.status === 'pending_approval' && !await this.voting.prepare(id)) return;
    if (this.transport) await this.transport.deliver(this.service, id, this.voting);
  }
  async retry() {
    if (!this.voting.ready()) return;
    this.voting.closeDue();
    await require('./regimentTagRole').retryTagRoles(this.service);
    for (const r of this.service.store.read().regiments.filter(r => r.poll)) await this.deliver(r.id);
  }
}
module.exports = { ApprovalNotifications };
