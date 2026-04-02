// ════════════════════════════════════════════════════════════════════
// PARTE 1 — Migration do banco
// Execute: node src/config/migrate-celcoin-ccb.js
// ════════════════════════════════════════════════════════════════════
const pool = require('./db');

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Campos CCB na tabela de loans
      ALTER TABLE loans
        ADD COLUMN IF NOT EXISTS celcoin_application_id    VARCHAR(100),
        ADD COLUMN IF NOT EXISTS ccb_status                VARCHAR(30) DEFAULT 'NOT_ISSUED',
        ADD COLUMN IF NOT EXISTS ccb_signature_url_borrower TEXT,
        ADD COLUMN IF NOT EXISTS ccb_signature_url_investor TEXT,
        ADD COLUMN IF NOT EXISTS ccb_document_url          TEXT,
        ADD COLUMN IF NOT EXISTS ccb_signed_url            TEXT,
        ADD COLUMN IF NOT EXISTS ccb_signed_at             TIMESTAMP,
        ADD COLUMN IF NOT EXISTS ccb_borrower_signed_at    TIMESTAMP,
        ADD COLUMN IF NOT EXISTS ccb_investor_signed_at    TIMESTAMP,
        ADD COLUMN IF NOT EXISTS ccb_simulated_total       DECIMAL(12,2),
        ADD COLUMN IF NOT EXISTS ccb_simulated_parcela     DECIMAL(12,2),
        ADD COLUMN IF NOT EXISTS ccb_iof                   DECIMAL(12,2),
        ADD COLUMN IF NOT EXISTS ccb_updated_at            TIMESTAMP;

      -- Campos Celcoin na tabela de usuários
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS celcoin_borrower_id  VARCHAR(100),
        ADD COLUMN IF NOT EXISTS birth_date           DATE;

      CREATE INDEX IF NOT EXISTS idx_loans_celcoin_app ON loans(celcoin_application_id);
    `);
    console.log('✅ Migration CCB Celcoin concluída!');
  } catch (err) {
    console.error('❌ Erro:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
};

if (require.main === module) migrate();

// ════════════════════════════════════════════════════════════════════
// PARTE 2 — Rotas (adicione ao src/routes/index.js)
// ════════════════════════════════════════════════════════════════════

/*
const ccbCtrl = require('../controllers/celcoinCCBController');

// Onboarding do tomador na Celcoin (chamado no cadastro)
router.post('/ccb/cadastrar-tomador', auth, borrowerOnly, ccbCtrl.cadastrarTomador);

// Buscar link de assinatura
router.get('/ccb/:loan_id/link', auth, ccbCtrl.getLinkAssinatura);

// Download do PDF
router.get('/ccb/:loan_id/download', auth, ccbCtrl.downloadCCB);

// Webhook Celcoin CCB — sem JWT
// Configure no painel Celcoin: https://SEU_BACKEND/api/webhooks/celcoin-ccb
router.post('/webhooks/celcoin-ccb', ccbCtrl.webhookCCB);
*/

// ════════════════════════════════════════════════════════════════════
// PARTE 3 — Integrar no loanController.js (fundLoan)
// Adicione logo após o COMMIT da liberação do empréstimo:
// ════════════════════════════════════════════════════════════════════

/*
const ccbCtrl = require('./celcoinCCBController');

// Emite CCB de forma assíncrona (não bloqueia a resposta ao investidor)
ccbCtrl.emitirCCB(loan.id).catch(err =>
  console.error('Erro ao emitir CCB:', err.message)
);
*/

// ════════════════════════════════════════════════════════════════════
// PARTE 4 — Variáveis de ambiente (.env)
// ════════════════════════════════════════════════════════════════════

/*
# Celcoin — já existentes (PIX)
CELCOIN_CLIENT_ID=seu_client_id
CELCOIN_CLIENT_SECRET=seu_client_secret
CELCOIN_ENV=sandbox

# Celcoin — CCB (fornecidos após setup do produto de crédito)
CELCOIN_CCB_PRODUCT_ID=uuid-do-produto-de-credito
CELCOIN_FUNDING_ID=uuid-do-funding-investidor

# URL do app (para callback após assinatura)
APP_URL=https://credigrupo-backend.up.railway.app

# E-mail
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=credigrupo@gmail.com
SMTP_PASS=senha_de_app_do_gmail
*/
