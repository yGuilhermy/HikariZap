const {prepareEnvironment} = require('../index');
prepareEnvironment();
const config = require('../src/config');
const {validateConfiguration} = require('../src/config/validate');
const {logger} = require('../src/utils/logger');
const report = validateConfiguration(config);
for (const warning of report.warnings) logger.warn(warning);
for (const error of report.errors) logger.error(error);
logger.info('Disponibilidade local de funções:',report.capabilities);
if (report.errors.length) {
    logger.error('Configuração inválida. Corrija as variáveis indicadas; nenhuma conexão WhatsApp foi aberta.');
    process.exitCode = 1;
} else {
    logger.info('Configuração válida. Nenhuma conexão WhatsApp ou requisição a provedor foi realizada.');
}
