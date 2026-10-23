 'use strict';
const field = (name, value) => ({ name, value, inline: false });
const embed = (title, description, fields) => ({ title, description, color: 0x5865f2, fields, footer: { text: 'Quartermaster | Legion of Loyalists' } });
const syncFields = [
 field('User Role Sync', 'Reconcile **your own roles only**. You must be in LOL to receive coalition roles.'),
 field('Regiment Role Sync', 'Reconcile one regiment. Available to its leader, a source-server manager (Manage Server), or a coalition admin.\nFrom LOL, provide the registered regiment name.'),
 field('Coalition Role Sync', 'Reconcile the whole coalition. **Coalition admins only, in LOL.** Intended once per war; there is no artificial war limit.')
];
const voting = 'Officers vote for **48 hours**. The majority of votes cast inside each regiment becomes **one regiment vote**.\nMore than 50% of **all eligible regiments** must vote yes. No early acceptance; ties and no votes do not count as yes.\nOnly eligible registered leaders can veto. Applicants cannot vote or veto their own admission.';
function infoPayload(category) {
 let embeds;
 if (category === 'getting-started') embeds = [embed('Getting Started', 'Set up your regiment, then connect its roles to LOL.', [
  field('1. Add Quartermaster', 'Use `/invite` for the bot invite. Add it to **your regiment server**.\nBot setup requires the existing Guild Members intent; contact the bot operator if member access is unavailable.'),
  field('2. Prepare two roles', 'Create or choose separate **Member** and **Officer** roles in your regiment server.'),
  field('3. Submit your application', 'In **your regiment server**, use `/create-regiment name:Name tag:TAG`. Requires **Manage Server**.\nChoose both role names in the private menus, then select **Submit application**. Discord supplies the IDs automatically; no IDs to type.'),
  field('4. Wait for the admission vote', 'Your application remains pending. No LOL roles or regiment sync are enabled before approval.\n'+voting),
  field('5. Join LOL', '[Join Legion of Loyalists](https://discord.gg/8ew5AEq5x9)\nNeed help? Contact **@BravoMike185**.'),
  field('6. Synchronize your roles', 'In <#1563207553687748779>, use `/rolesync` to open the three controls below. Check `/regiment-status` for progress and errors.')
 ]), embed('Choose a sync option', 'Use the smallest scope that fits your task.', syncFields)];
 else if (category === 'lol') embeds = [embed('Legion of Loyalists', 'A Colonial Loyalist coalition.', [
  field('Independent leadership', 'Each regiment keeps its own leadership and identity.'),
  field('Cooperation', 'Regiments work together voluntarily. Coalition operations are **not compulsory**.'),
  field('Facilities', 'There is **no central coalition facility**.'),
  field('What Quartermaster does', 'Connects regiment membership and leadership to coalition access, and supports regiment admission and role synchronization.'),
  field('Join or ask a question', '[Join LOL](https://discord.gg/8ew5AEq5x9)\nContact **@BravoMike185** for help.')
 ])];
 else embeds = [embed('Commands | Regiment setup', 'Run setup commands in your regiment server unless stated otherwise.', [
  field('/create-regiment', '**Manage Server** required. Submit name/tag, choose Member and Officer roles by name, then confirm. IDs are filled automatically. Optional slash role choices still work.'),
  field('/regiment-settings', 'Everyone can view settings. **Regiment leader or coalition admin** may change mappings or resync.\nChange roles through **Edit role mappings** in the source regiment server.'),
  field('/regiment-status', 'View registration, roles, vote deadline, sync progress and errors. From LOL, provide the registered regiment name.'),
  field('/delete-regiment', '**Regiment leader or coalition admin** only. Requires typing **ACCEPT** in the confirmation. Access through other regiments is preserved.'),
  field('Admission rules', voting)
 ]), embed('Commands | Synchronization and help', 'Open /rolesync in the existing rolesync channel.', [
  ...syncFields,
  field('/info and /invite', 'Information and the existing bot invite.\n[Join LOL](https://discord.gg/8ew5AEq5x9) | Contact **@BravoMike185**.')
 ]), embed('Commands | Existing server tools', 'Use these in their configured server. Existing permission checks still apply.', [
  field('Ranks and warnings', '`/promote`: officers/admins; recruitment officers are limited to initial recruitment.\n`/demote`, `/discharge`: officers/admins with rank restrictions.\n`/promoteally`, `/warning`, `/warningstatus`: officers.'),
  field('Activity and war tools', '`/activitycheck`, `/clearactivitycheck`: officers.\n`/activitycheckroster`: members; Mark Active toggles yourself.\n`/killcount add`: members/officers; start/remove/reset/end: officers.\n`/startrollover`, `/cancelrollover`: officers.'),
  field('Operations and training', '`/operation`, `/training`: Manage Server visibility plus officer checks.\nMembers join/leave using buttons; creators/officers manage events.'),
  field('Panels and configuration', '`/reactionrole setup`: Manage Server plus officer check; role buttons toggle yourself.\n`/botpanel`: Manage Server plus officers.\n`/ticketpanel`: Manage Server; members open tickets and recruitment officers process them.\n`/config`: Manage Server; channels, roles and welcome-image settings.'),
  field('Automatic features', 'Welcome, allied verification, leaving notices, warning expiry/votes, event panels and rollover remain available. Regiment sync reacts to role and membership changes and retries failures.')
 ])];
 return { content: '', embeds, components: [], allowedMentions: { parse: [] } };
}
module.exports = { infoPayload };
