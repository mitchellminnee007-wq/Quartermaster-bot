const commands = require('../utils/regimentCommands');
module.exports = { data: commands.definition('regiment-status'), execute: commands.execute };
