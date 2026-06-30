const { getConfig } = require('./config');
const { ROLE_IDS, OFFICER_ROLE_IDS, KILL_ADD_ROLE_IDS } = require('./roleIds');

const OFFICER_RANKS = ['Officer', 'Commander'];
const KILL_RANKS = ['Officer', 'Commander', 'Member'];

function cleanEnvValue(value) {
  if (!value) return null;
  return value.split('//')[0].trim() || null;
}

function getBotAdminRoleId(guildId) {
  return (
    getConfig(guildId, 'BOT_ADMIN_ROLE_ID')
    || cleanEnvValue(process.env.BOT_ADMIN_ROLE_ID)
    || ROLE_IDS.BOT_ADMIN_ROLE_ID
  );
}

function getOfficerRoleIds(guildId) {
  const leaderId = getConfig(guildId, 'REGIMENTAL_LEADER_ROLE_ID') || ROLE_IDS.REGIMENTAL_LEADER_ROLE_ID;
  const officerId = getConfig(guildId, 'REGIMENT_OFFICER_ROLE_ID') || ROLE_IDS.REGIMENT_OFFICER_ROLE_ID;
  return [leaderId, officerId].filter(Boolean);
}

function hasAnyRole(member, roleIds) {
  return roleIds.some(roleId => member.roles.cache.has(roleId));
}

function isBotAdmin(member) {
  const roleId = getBotAdminRoleId(member.guild.id);
  return !!roleId && member.roles.cache.has(roleId);
}

function isOfficer(member) {
  return isBotAdmin(member)
    || hasAnyRole(member, getOfficerRoleIds(member.guild.id))
    || member.roles.cache.some(role => OFFICER_RANKS.includes(role.name));
}

function isRecruitmentOfficer(member) {
  if (isBotAdmin(member)) return true;

  const recruitmentRoleId = getConfig(member.guild.id, 'RECRUITMENT_OFFICER_ROLE_ID');
  if (recruitmentRoleId) {
    return member.roles.cache.has(recruitmentRoleId);
  }

  return hasAnyRole(member, OFFICER_ROLE_IDS)
    || member.roles.cache.some(role => OFFICER_RANKS.includes(role.name));
}

function canAddKills(member) {
  return isBotAdmin(member)
    || hasAnyRole(member, KILL_ADD_ROLE_IDS)
    || member.roles.cache.some(role => KILL_RANKS.includes(role.name));
}

module.exports = {
  isBotAdmin,
  isOfficer,
  isRecruitmentOfficer,
  canAddKills,
};