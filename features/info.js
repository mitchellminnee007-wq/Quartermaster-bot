const commands = require('../utils/regimentCommands');
module.exports = { data: commands.definition('info'), execute: commands.execute };
