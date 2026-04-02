const cron = require('node-cron');
const { runCobrancaJob } = require('./cobrancaJob');

const iniciarJobs = () => {
  // Régua de cobrança — todo dia às 08:00 (horário de Brasília)
  cron.schedule('0 8 * * *', async () => {
    console.log('[CRON] Disparando régua de cobrança...');
    await runCobrancaJob();
  }, { timezone: 'America/Sao_Paulo' });

  // Limpeza de sessões KYC expiradas — toda madrugada às 02:00
  cron.schedule('0 2 * * *', async () => {
    const db = require('../config/db');
    await db.query('DELETE FROM kyc_sessions WHERE expires_at < NOW() AND used = false');
    console.log('[CRON] Sessões KYC expiradas removidas');
  }, { timezone: 'America/Sao_Paulo' });

  // Expirar códigos de empréstimo antigos — toda hora
  cron.schedule('0 * * * *', async () => {
    const db = require('../config/db');
    await db.query(
      "UPDATE loans SET status = 'cancelled' WHERE status = 'open' AND expires_at < NOW()"
    );
  }, { timezone: 'America/Sao_Paulo' });

  console.log('[CRON] Jobs agendados: cobrança (08h), KYC cleanup (02h), expirar códigos (hora em hora)');
};

module.exports = { iniciarJobs };
