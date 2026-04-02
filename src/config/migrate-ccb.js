// ════════════════════════════════════════════════════════
// ARQUIVO 1: migrate-ccb.js
// Execute: node src/config/migrate-ccb.js
// ════════════════════════════════════════════════════════

const pool = require('./db');

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE loans
        ADD COLUMN IF NOT EXISTS mova_quotation_id      VARCHAR(100),
        ADD COLUMN IF NOT EXISTS mova_proposal_id       VARCHAR(100),
        ADD COLUMN IF NOT EXISTS ccb_number             VARCHAR(50),
        ADD COLUMN IF NOT EXISTS ccb_url                TEXT,
        ADD COLUMN IF NOT EXISTS ccb_signed_url         TEXT,
        ADD COLUMN IF NOT EXISTS ccb_status             VARCHAR(30) DEFAULT 'not_issued',
        ADD COLUMN IF NOT EXISTS signature_link_borrower TEXT,
        ADD COLUMN IF NOT EXISTS signature_link_investor TEXT,
        ADD COLUMN IF NOT EXISTS borrower_signed_at     TIMESTAMP,
        ADD COLUMN IF NOT EXISTS investor_signed_at     TIMESTAMP,
        ADD COLUMN IF NOT EXISTS ccb_signed_at          TIMESTAMP;

      CREATE INDEX IF NOT EXISTS idx_loans_mova_proposal ON loans(mova_proposal_id);
    `);
    console.log('✅ Migração CCB concluída!');
  } catch (err) {
    console.error('❌ Erro:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
};

migrate();

// ════════════════════════════════════════════════════════
// ARQUIVO 2: Rotas CCB — adicione ao src/routes/index.js
// ════════════════════════════════════════════════════════

/*
const ccbController = require('../controllers/ccbController');

// CCB — Mova
router.get('/loans/:loan_id/ccb/link',     auth, ccbController.getLinkAssinatura);
router.get('/loans/:loan_id/ccb/download', auth, ccbController.downloadCCB);

// Webhook da Mova — sem JWT (Mova chama direto)
// Configure no painel Mova: https://SEU_BACKEND/api/webhooks/mova
router.post('/webhooks/mova', ccbController.webhookMova);
*/

// ════════════════════════════════════════════════════════
// ARQUIVO 3: Variáveis .env — adicione ao seu .env
// ════════════════════════════════════════════════════════

/*
# Mova — Emissão de CCB
MOVA_ENV=sandbox
MOVA_API_KEY=sua_api_key_aqui
MOVA_CLIENT_ID=seu_mova_client_id_aqui
MOVA_PRODUCT_ID=seu_product_id_aqui

# E-mail para envio das CCBs
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=credigrupo@gmail.com
SMTP_PASS=senha_de_app_gmail
*/

// ════════════════════════════════════════════════════════
// ARQUIVO 4: Integrar no loanController.js (fundLoan)
// Logo após o COMMIT da liberação, adicione:
// ════════════════════════════════════════════════════════

/*
// No final do bloco try do fundLoan, após await client.query('COMMIT'):
const ccbController = require('./ccbController');
// Emite a CCB de forma assíncrona (não bloqueia a resposta)
ccbController.emitirCCB(loan.id).catch(err =>
  console.error('Erro ao emitir CCB:', err.message)
);
*/
