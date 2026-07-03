const fs = require('node:fs');
const path = require('node:path');
const { Events, EmbedBuilder } = require('discord.js');
const { getConfig } = require('../utils/config');
const {
  ROLE_IDS,
  ZERO_SUM_SOURCE_GUILD_ID,
  ZERO_SUM_VERIFIED_ROLE_IDS,
} = require('../utils/roleIds');

const ALLIED_TARGET_GUILD_ID = '1521261614484033728';

function getRoleByName(guild, roleName) {
  const normalized = roleName.toLowerCase();
  return guild.roles.cache.find(role => role.name.toLowerCase() === normalized) || null;
}

module.exports = (client) => {
  // Welcome new members: ping and direct them to verification and rules
  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      const welcomeChannelId      = getConfig(member.guild.id, 'WELCOME_CHANNEL_ID');
      const verificationChannelId  = getConfig(member.guild.id, 'VERIFICATION_CHANNEL_ID');
      const rulesChannelId         = getConfig(member.guild.id, 'RULES_CHANNEL_ID');

      const unverifiedRoleId = getConfig(member.guild.id, 'UNVERIFIED_ROLE_ID');
      let unverifiedRole = null;
      if (unverifiedRoleId) {
        unverifiedRole = member.guild.roles.cache.get(unverifiedRoleId)
          || await member.guild.roles.fetch(unverifiedRoleId).catch(() => null);
      }
      if (!unverifiedRole) {
        unverifiedRole = getRoleByName(member.guild, 'unverified');
      }
      if (unverifiedRole && !member.roles.cache.has(unverifiedRole.id)) {
        await member.roles.add(unverifiedRole).catch(err => console.error('Failed to add unverified role to new member:', err));
      } else if (!unverifiedRole) {
        console.warn('Could not find unverified role.');
      }

      if (member.guild.id === ALLIED_TARGET_GUILD_ID) {
        try {
          const zeroSumGuild = client.guilds.cache.get(ZERO_SUM_SOURCE_GUILD_ID)
            || await client.guilds.fetch(ZERO_SUM_SOURCE_GUILD_ID).catch(() => null);

          if (!zeroSumGuild) {
            console.warn('Could not find ZERO_SUM guild for allied verification.');
          } else {
            const zeroSumMember = await zeroSumGuild.members.fetch(member.id).catch(() => null);
            if (zeroSumMember) {
              const isVerifiedInZeroSum = ZERO_SUM_VERIFIED_ROLE_IDS.some(roleId => zeroSumMember.roles.cache.has(roleId));

              if (isVerifiedInZeroSum) {
                const roleIdsToAdd = [ROLE_IDS.MEMBER_ROLE_ID, ROLE_IDS.ZERO_SUM_ROLE_ID]
                  .filter(Boolean)
                  .filter(roleId => !member.roles.cache.has(roleId));

                if (roleIdsToAdd.length > 0) {
                  await member.roles.add(roleIdsToAdd, 'Auto-verified from ZERO_SUM alliance roles');
                }

                if (unverifiedRole && member.roles.cache.has(unverifiedRole.id)) {
                  await member.roles.remove(unverifiedRole.id).catch(err => console.error('Failed removing unverified role after allied verification:', err));
                }
              }
            }
          }
        } catch (alliedVerificationError) {
          console.error('Allied verification check failed:', alliedVerificationError);
        }
      }

      const verificationMention = verificationChannelId ? `<#${verificationChannelId}>` : 'the verification channel';
      const rulesMention = rulesChannelId ? `<#${rulesChannelId}>` : 'the rules channel';

      if (!welcomeChannelId) {
        console.warn('WELCOME_CHANNEL_ID not configured; skipping welcome message.');
        return;
      }

      const channel = member.guild.channels.cache.get(welcomeChannelId)
        || await member.guild.channels.fetch(welcomeChannelId).catch(() => null);
      if (!channel) {
        console.warn('Could not find welcome channel with ID', welcomeChannelId);
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`Welcome to ${member.guild.name}`)
        .setDescription(`Hello ${member}, welcome aboard! Please complete verification in ${verificationMention} and read ${rulesMention} to join the ranks.\nBonjour ${member}, bienvenue à bord ! Veuillez compléter la vérification dans ${verificationMention} et lire ${rulesMention} pour rejoindre les rangs.`)
        .setColor(0xff0000)
        .setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }))
        .setFooter({ text: 'Qualification Bot • Welcome aboard.' })
        .setTimestamp();

      const messagePayload = {
        content: `${member}`,
        embeds: [embed],
        allowedMentions: { users: [member.id] }
      };

      const welcomeImageUrl = getConfig(member.guild.id, 'WELCOME_IMAGE_URL');
      if (welcomeImageUrl) {
        const normalizedUrl = welcomeImageUrl.trim();
        const isRemoteImage = /^https?:\/\//i.test(normalizedUrl) || /^attachment:/i.test(normalizedUrl);
        if (isRemoteImage) {
          embed.setImage(normalizedUrl);
        } else {
          const resolvedPath = path.isAbsolute(normalizedUrl)
            ? path.normalize(normalizedUrl)
            : path.resolve(path.join(__dirname, '..'), normalizedUrl);

          if (fs.existsSync(resolvedPath)) {
            const imageName = path.basename(resolvedPath);
            messagePayload.files = [{ attachment: resolvedPath, name: imageName }];
            embed.setImage(`attachment://${imageName}`);
          } else {
            console.warn('WELCOME_IMAGE_URL file not found:', resolvedPath, 'original:', welcomeImageUrl);
          }
        }
      }

      await channel.send(messagePayload);
    } catch (err) {
      console.error('Error sending welcome message:', err);
    }
  });
};
