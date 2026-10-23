const commands = require('../utils/regimentCommands');
module.exports = { data: commands.definition('create-regiment'), execute: commands.execute, init: commands.init };
