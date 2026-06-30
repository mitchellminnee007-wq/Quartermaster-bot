const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isOfficer } = require('../utils/permissions');
const { ROLE_IDS } = require('../utils/roleIds');

const officerRanks = ['Officer', 'Commander'];

function getRoleByName(guild, roleName) {
  const normalized = roleName.toLowerCase();
  return guild.roles.cache.find(role => role.name.toLowerCase() === normalized) || null;
}

function getRoleByIdOrName(guild, roleId, fallbackName) {
  if (roleId && guild.roles.cache.has(roleId)) {
    return guild.roles.cache.get(roleId);
  }
  return getRoleByName(guild, fallbackName);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('promoteally')
    .setDescription('Promote a member from unranked to Ally.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The member to promote to Ally')
        .setRequired(true)
    )
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getMember('user', true);
    if (!target || !target.guild) {
      return interaction.reply({ content: 'That member is not available.', ephemeral: true });
    }

    const executor = interaction.member;
    if (!isOfficer(executor)) {
      return interaction.reply({ content: 'Only Officers and Commanders can promote allies.', ephemeral: true });
    }

    const allyRole = getRoleByIdOrName(interaction.guild, ROLE_IDS.ALLY_ROLE_ID, 'Ally');
    if (!allyRole) {
      return interaction.reply({ content: 'The role "Ally" does not exist on this server.', ephemeral: true });
    }

    if (target.roles.cache.has(allyRole.id)) {
      return interaction.reply({ content: 'That member is already an Ally.', ephemeral: true });
    }

    await target.roles.add(allyRole);

    const cleanupRoles = [
      getRoleByIdOrName(interaction.guild, ROLE_IDS.GUEST_ROLE_ID, 'unverified'),
    ]
      .filter(role => role && target.roles.cache.has(role.id));

    if (cleanupRoles.length) {
      await target.roles.remove(cleanupRoles);
    }

    const embed = new EmbedBuilder()
      .setTitle('Ally Promotion Complete')
      .setColor('#00FF00')
      .setDescription(`${target.user.tag} has been promoted from **Unranked** to ${allyRole}!`)
      .setFooter({ text: `Promoted by ${executor.user.tag}` })
      .setTimestamp();

    await interaction.reply({
      content: `${target}`,
      embeds: [embed],
      allowedMentions: { users: [target.id], roles: [allyRole.id] },
      ephemeral: false
    });
  }
};
