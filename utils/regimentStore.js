'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const ID = /^\d{17,20}$/;
const norm = value => String(value).trim().toLowerCase();
class RegimentStore {
  constructor(file = path.join(__dirname, '..', 'data', 'regiments.json')) { this.file = file; }
  read() {
    if (!fs.existsSync(this.file)) return { version: 1, regiments: [], grants: {}, audit: [] };
    const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.regiments) || !data.grants || !Array.isArray(data.audit)) throw new Error('Invalid regiment database; restore a verified backup.');
    return data;
  }
  change(fn) {
    const data = this.read();
    const result = fn(data);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    let fd;
    try {
      fd = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temp, this.file);
    } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    return result;
  }
  audit(data, action, actor = {}, detail = {}) {
    data.audit.push({ id: randomUUID(), timestamp: new Date().toISOString(), action, userId: actor.userId || null, guildId: actor.guildId || null, ...detail });
  }
  log(action, actor, detail) { this.change(d => this.audit(d, action, actor, detail)); }
  decide() { throw new Error('Direct admin approval is disabled; use the regiment ballot.'); }
  create(input, actor) {
    const name = String(input.name || '').trim(), tag = String(input.tag || '').trim();
    if (!name || name.length > 80 || !tag || tag.length > 16 || /[\r\n\x00-\x1f]/.test(name + tag)) throw new Error('Name (1–80) and tag (1–16) must be valid single-line text.');
    for (const key of ['guildId', 'commanderId', 'memberRoleId', 'officerRoleId']) if (!ID.test(input[key] || '')) throw new Error(`Invalid Discord ID: ${key}`);
    if (input.memberRoleId === input.officerRoleId) throw new Error('Select different Member and Officer roles.');
    return this.change(d => {
      if (d.regiments.some(r => r.status !== 'rejected' && (r.guildId === input.guildId || norm(r.name) === norm(name) || norm(r.tag) === norm(tag)))) throw new Error('Name, tag or server is already registered (including pending removal).');
      const r = { id: randomUUID(), name, tag, guildId: input.guildId, commanderId: input.commanderId, memberRoleId: input.memberRoleId, officerRoleId: input.officerRoleId, status: 'pending_approval', poll: { state: 'policy_pending' }, registeredAt: new Date().toISOString(), lastSuccessfulSync: null, syncError: null };
      d.regiments.push(r); this.audit(d, 'registration-requested', actor, { regimentId: r.id }); return r;
    });
  }
}
module.exports = { RegimentStore, ID, norm };
