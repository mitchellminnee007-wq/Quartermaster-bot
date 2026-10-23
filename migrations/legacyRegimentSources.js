'use strict';
// One-time migration evidence, copied exactly from the pre-migration roleIds.js and welcome.js.
// These are legacy access mappings, NOT complete/approved voting registrations.
module.exports = [
  { key: 'ZERO_SUM', guildId: '1475414633211760796', members: ['1479105409989080000', '1479105113242210000', '1479105025862010000'], officers: ['1479105409989080000'], memberRoleNames: ['CO', 'NCO', 'Enlisted'], officerRoleNames: ['CO'], targetTagRoleId: '1521294074596823182', source: 'utils/roleIds.js:ZERO_SUM_*; features/welcome.js:ZeroSum verification', registrationExcludedByUser: true, verification: { state: 'unavailable', discordCode: 10004 }, missingRegistrationFields: ['confirmed name/tag', 'commander user ID', 'live source-role verification'] },
  { key: 'HUSS', guildId: '1385714710405582858', members: ['1386233581612826704', '1386230860587733123'], officers: ['1386233581612826704'], memberRoleNames: ['Officer', 'Member'], officerRoleNames: ['Officer'], targetTagRoleId: '1521293923073527828', source: 'utils/roleIds.js:HUSS_*; features/welcome.js:Huss verification', verification: { state: 'roles-verified', guildName: 'The Winged Hussars Industries', targetTagName: 'HUSS' }, confirmedCommanderId: '781549558588112916', missingRegistrationFields: [] },
];
