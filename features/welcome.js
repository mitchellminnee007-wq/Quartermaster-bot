const fs = require('node:fs');
const path = require('node:path');
const { Events, EmbedBuilder } = require('discord.js');
const { getConfig } = require('../utils/config');
const {
  ROLE_IDS,
  ZERO_SUM_SOURCE_GUILD_ID,
  ZERO_SUM_VERIFIED_ROLE_IDS,
  ZERO_SUM_OFFICER_ROLE_IDS,
  HUSS_SOURCE_GUILD_ID,
  HUSS_VERIFIED_ROLE_IDS,
  HUSS_OFFICER_ROLE_IDS,
} = require('../utils/roleIds');

const ALLIED_TARGET_GUILD_ID = '1521261614484033728';

function shouldAttemptAlliedVerification(guildId) {
  return [
    ALLIED_TARGET_GUILD_ID,
    ZERO_SUM_SOURCE_GUILD_ID,
    HUSS_SOURCE_GUILD_ID,
  ].includes(guildId);
}

function getRoleByName(guild, roleName) {
  const normalized = roleName.toLowerCase();
  return guild.roles.cache.find(role => role.name.toLowerCase() === normalized) || null;
}

async function hasAnySourceRole(client, userId, sourceGuildId, roleIds, roleNames = []) {
  const registry = new (require('../utils/regimentStore').RegimentStore)().read();
  if (registry.regiments.some(r => r.guildId === sourceGuildId) || (registry.disabledLegacy || []).includes(sourceGuildId)) return false;
  const sourceGuild = client.guilds.cache.get(sourceGuildId)
    || await client.guilds.fetch(sourceGuildId).catch(() => null);

  if (!sourceGuild) {
    return false;
  }

  const sourceMember = await sourceGuild.members.fetch(userId).catch(() => null);
  if (!sourceMember) {
    return false;
  }

  const candidateRoleIds = new Set(roleIds);
  const normalizedRoleNames = (roleNames || []).map(name => name.toLowerCase());

  for (const role of sourceGuild.roles.cache.values()) {
    if (normalizedRoleNames.includes(role.name.toLowerCase())) {
      candidateRoleIds.add(role.id);
    }
  }

  return [...candidateRoleIds].some(roleId => sourceMember.roles.cache.has(roleId));
}

function registerWelcomeHandler(client) {
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

      if (shouldAttemptAlliedVerification(member.guild.id)) {
        try {
          const roleIdsToAdd = new Set();
          let isAutoVerified = false;

          const isVerifiedInZeroSum = await hasAnySourceRole(
            client,
            member.id,
            ZERO_SUM_SOURCE_GUILD_ID,
            ZERO_SUM_VERIFIED_ROLE_IDS,
            ['CO', 'NCO', 'Enlisted'],
          );
          if (isVerifiedInZeroSum) {
            isAutoVerified = true;
            roleIdsToAdd.add(ROLE_IDS.MEMBER_ROLE_ID);
            roleIdsToAdd.add(ROLE_IDS.ZERO_SUM_ROLE_ID);

            const isZeroSumOfficer = await hasAnySourceRole(
              client,
              member.id,
              ZERO_SUM_SOURCE_GUILD_ID,
              ZERO_SUM_OFFICER_ROLE_IDS,
              ['CO'],
            );
            if (isZeroSumOfficer) {
              roleIdsToAdd.add(ROLE_IDS.REGIMENT_OFFICER_ROLE_ID);
            }
          }

          const isVerifiedInHuss = await hasAnySourceRole(
            client,
            member.id,
            HUSS_SOURCE_GUILD_ID,
            HUSS_VERIFIED_ROLE_IDS,
            ['Officer', 'Member'],
          );
          if (isVerifiedInHuss) {
            isAutoVerified = true;
            roleIdsToAdd.add(ROLE_IDS.MEMBER_ROLE_ID);
            roleIdsToAdd.add(ROLE_IDS.HUSS_ROLE_ID);

            const isHussOfficer = await hasAnySourceRole(
              client,
              member.id,
              HUSS_SOURCE_GUILD_ID,
              HUSS_OFFICER_ROLE_IDS,
              ['Officer'],
            );
            if (isHussOfficer) {
              roleIdsToAdd.add(ROLE_IDS.REGIMENT_OFFICER_ROLE_ID);
            }
          }

          const missingRoleIds = [...roleIdsToAdd]
            .filter(Boolean)
            .filter(roleId => !member.roles.cache.has(roleId));

          if (missingRoleIds.length > 0) {
            await member.roles.add(missingRoleIds, 'Auto-verified from allied regiment roles');
          }

          if (isAutoVerified && unverifiedRole && member.roles.cache.has(unverifiedRole.id)) {
            await member.roles.remove(unverifiedRole.id).catch(err => console.error('Failed removing unverified role after allied verification:', err));
          }

          if (isAutoVerified && ROLE_IDS.GUEST_ROLE_ID && member.roles.cache.has(ROLE_IDS.GUEST_ROLE_ID)) {
            await member.roles.remove(ROLE_IDS.GUEST_ROLE_ID).catch(err => console.error('Failed removing guest role after allied verification:', err));
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
}

module.exports = registerWelcomeHandler;
module.exports.shouldAttemptAlliedVerification = shouldAttemptAlliedVerification;

