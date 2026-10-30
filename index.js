const fs = require('node:fs');
const path = require('node:path');

function prepareEnvironment() {
    process.chdir(__dirname);
    require('dotenv').config({path:path.join(__dirname,'.env')});
    const localPython = path.join(__dirname,'.venv',process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    if (fs.existsSync(localPython) && (!process.env.PYTHON_PATH || !fs.existsSync(process.env.PYTHON_PATH))) {
        process.env.PYTHON_PATH = localPython;
    }
}

if (require.main === module) {
    prepareEnvironment();
    const {logger} = require('./src/utils/logger');
    const config = require('./src/config');
    const {validateConfiguration} = require('./src/config/validate');
    const report = validateConfiguration(config);
    config.capabilities = report.capabilities;
    for (const warning of report.warnings) logger.warn(warning);
    if (report.errors.length) {
        for (const error of report.errors) logger.error(error);
        logger.error('Corrija as variáveis indicadas no .env antes de conectar. Nenhuma tentativa de login foi feita.');
        process.exitCode = 1;
    } else {
        logger.system('Hikari Zap: configuração carregada; iniciando conexão.');
        require('./src/whatsapp/client').start().catch(error => {
            logger.error('Falha ao iniciar Hikari Zap:',error);
            process.exitCode = 1;
        });
    }
}
module.exports = {prepareEnvironment};
