# Regiment registration and role synchronization

## Existing project and storage

This is the existing Node/CommonJS discord.js bot. Existing feature JSON files and configuration remain in place. The new versioned `data/regiments.json` extends that storage convention; no SQL database or regiment registry existed in this checkout. A missing file initializes an empty registry on its first mutation. Malformed/unknown-version data fails closed and is never silently reset. Records contain UUID, name/tag, source guild, commander, source role mappings, status, registration date, sync health and seen users. The same atomic snapshot contains the grant journal and audit log.

Only one bot process may own this data file. Existing PM2 runs in single-instance fork mode; do not enable cluster mode or multiple replicas. The serialized job queue prevents in-process races. Writes use a same-directory temporary file, fsync and rename. Keep the data directory on persistent local storage on the VPS; retain backups. JSON storage is intended for this bot's existing deployment, not multi-host concurrent writers.

## Commands

- `/create-regiment name tag member officer` in the source server: Manage Server; selected roles must belong to that guild and cannot be everyone, managed or identical. Names/tags are case-insensitively unique. The caller becomes commander. Registration persists even if the initial role grant fails, with a visible error and retry.
- `/delete-regiment name`: commander or coalition administrator, confirmed by an exact `ACCEPT` modal. Authorization is checked again on submission. Deleting registrations stop contributing immediately. Cleanup retries until successful; only then is the registration removed. Other regiment entitlements remain.
- `/regiment-settings [name] [member] [officer] [resync]`: readable by members; changes require commander or coalition admin, and role mapping changes must be made in the source guild. Reinvited suspended registrations can be resumed using resync by a commander/admin who also has Manage Server in the source guild.
- `/regiment-status [name]`: configuration, registration state, last successful full sync and errors.
- `/rolesync [scope] [name]`: without scope, displays the three controls; use it in the existing #rolesync channel. User scope only affects the caller. Regiment scope requires commander, source server Manage Server or coalition admin. In LOL, provide the regiment name. Coalition scope only works in LOL for its administrators or the existing bot-admin role; intended once per war, with no invented war counter or hard limit.
- `/info category`: Getting Started, LOL and Commands. Existing `/invite` provides the existing bot OAuth link. No OAuth scope, portal setting or privileged intent has been changed. The existing LOL #rolesync channel was verified read-only as 1563207553687748779. No controls were present in its latest 30 messages; use /rolesync there to display the three controls. Regiment Role Sync asks for a registered name so it also works from LOL. No old panel was overwritten. A verified LOL invitation URL was not present; contact @BravoMike185 for the join link.

Coalition IDs reuse `utils/roleIds.js` and the existing allied target guild from welcome.js. Automatic synchronization reacts to source roles, membership changes, target joins, role deletion and bot removal. Retries and recovery run at startup and every five minutes. A fresh deployment with no registrations/grants does not perform a startup coalition sweep. Regiment sweeps include source members and historically observed users so departing members are handled without touching unrelated users.

## Safety and recovery

The desired coalition roles are the union across active regiments. A missing source member is accepted only for Discord Unknown Member (10007); access/network errors stop that user's reconciliation. A missing mapping fails closed. Guild removal suspends registrations. Deleted legacy-source registrations remain disabled for legacy verification so it cannot accidentally recreate the removed access.

The journal records grant intent before the Discord API call. Retried adds/removes are idempotent. Removal only concerns roles in the journal, never all member roles. Existing roles not granted by this subsystem are intentionally not adopted or revoked: their provenance cannot safely be inferred. Legacy fixed-source verification remains available for unregistered sources; registered sources use the new mapping instead. Per-regiment cosmetic legacy roles are not created or managed by the new registry.

There is no distributed transaction across Discord and disk: registration/settings/deletion state is committed first, failures are recorded, and retries converge. Deleting records remain until cleanup succeeds. Avoid manually editing the journal while the bot is running. On an invalid database, stop the bot and restore a verified backup. Audit entries include timestamp, actor user/server where applicable, action and subject/error; automatic actions use a null system actor. Audit covers registration, deletion, mapping changes, manual sync, sync failures and unauthorized new commands. Back up and monitor file growth; audit retention is not silently truncated.

## Discord prerequisites

Guilds and Guild Members intents are already configured in index.js. If the Developer Portal's privileged intent is disabled, an operator must explicitly approve that change; this deployment does not enable it. The bot must be present in LOL and source servers. In LOL it needs View Channel, Send Messages/Embed Links for interaction UI and Manage Roles, with its highest role above the three mapped target roles. Source member/role enumeration needs the existing Guild Members intent. Registration callers need Manage Server. No new bot token, OAuth grant or hosting service is created.

## Validation and deployment

Run `node --test tests/regiments.test.js tests/welcome-verification.test.js`. All production-destructive scenarios use mocks and temporary stores. Do not start index.js locally against the production token while the VPS bot is running.

The existing deploy.ps1 uploads .env and data and can overwrite production state; it is intentionally NOT used for this feature deployment. Upload only the explicit code/test/document files, back up the matching remote files, run tests on the VPS and restart only PM2 `qualification-bot` at `/root/Quartermaster-bot`. Do not restart the other PM2 applications. Existing dependencies are unchanged.

Use `node deploy-regiments.js --check` to inspect command-name collisions before deployment. `node deploy-regiments.js` registers only the six new commands globally, because regiment servers need access; it does not bulk-replace existing commands or change their existing guild scope. Registration is repeatable by command name and reports partial progress. Discord global command availability can propagate after deployment. Preserve backups and the old command definitions for rollback.

