'use strict';
// Register only the six new commands globally; preserve all existing commands and scopes.
const { REST, Routes } = require('discord.js');
require('dotenv').config();
const names = ['create-regiment', 'delete-regiment', 'regiment-settings', 'regiment-status', 'rolesync', 'info'];
async function main() {
  const token = process.env.DISCORD_TOKEN?.trim(), app = process.env.CLIENT_ID?.trim();
  if (!token || !/^\d{17,20}$/.test(app || '')) throw new Error('Missing valid bot configuration');
  const rest = new REST({ version: '10' }).setToken(token);
  const me = await rest.get('/users/@me');
  if (me.id !== app) throw new Error('CLIENT_ID does not match the authenticated bot');
  const existing = await rest.get(Routes.applicationCommands(app));
  console.log(JSON.stringify({ existingGlobalCommands: existing.map(c => c.name), collisions: existing.filter(c => names.includes(c.name)).map(c => c.name) }));
  if (process.argv.includes('--check')) return;
  // A deployment operator must inspect --check before registering an overlapping name.
  for (const name of names) {
    const command = require(`./features/${name}.js`);
    await rest.post(Routes.applicationCommands(app), { body: command.data.toJSON() });
    console.log(`Registered /${name}`);
  }
}
main().catch(e => { console.error(`Command registration failed (${e.code || e.name}); existing commands were not bulk replaced.`); process.exitCode = 1; });
