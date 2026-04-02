const pool = require('./db');

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS kyc_status          VARCHAR(20) DEFAULT 'NOT_STARTED',
        ADD COLUMN IF NOT EXISTS kyc_proposal_id     VARCHAR(100),
        ADD COLUMN IF NOT EXISTS kyc_onboarding_id   VARCHAR(100),
        ADD COLUMN IF NOT EXISTS kyc_reproval_reason TEXT,
        ADD COLUMN IF NOT EXISTS celcoin_account_id  VARCHAR(100),
        ADD COLUMN IF NOT EXISTS kyc_doc_rg_frente   VARCHAR(100),
        ADD COLUMN IF NOT EXISTS kyc_doc_rg_verso    VARCHAR(100),
        ADD COLUMN IF NOT EXISTS kyc_doc_cnh         VARCHAR(100),
        ADD COLUMN IF NOT EXISTS kyc_doc_cpf         VARCHAR(100),
        ADD COLUMN IF NOT EXISTS kyc_doc_residencia  VARCHAR(100);

      CREATE TABLE IF NOT EXISTS kyc_sessions (
        id                  UUID PRIMARY KEY,
        user_id             UUID REFERENCES users(id),
        celcoin_session_id  VARCHAR(100),
        used                BOOLEAN DEFAULT false,
        expires_at          TIMESTAMP,
        created_at          TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_kyc_sessions_user    ON kyc_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_users_kyc_proposal   ON users(kyc_proposal_id);
      CREATE INDEX IF NOT EXISTS idx_users_kyc_onboarding ON users(kyc_onboarding_id);
    `);
    console.log('✅ Migration KYC concluída!');
  } catch (err) {
    console.error('❌ Erro:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
};

if (require.main === module) migrate();

/*
══════════════════════════════════════════════════════════
ROTAS — adicione ao src/routes/index.js
══════════════════════════════════════════════════════════
const kycCtrl = require('../controllers/kycController');

router.post('/kyc/iniciar',            auth, kycCtrl.iniciarKYC);
router.post('/kyc/upload/rg-frente',   auth, kycCtrl.uploadMiddleware, kycCtrl.uploadRGFrente);
router.post('/kyc/upload/rg-verso',    auth, kycCtrl.uploadMiddleware, kycCtrl.uploadRGVerso);
router.post('/kyc/upload/cnh',         auth, kycCtrl.uploadMiddleware, kycCtrl.uploadCNH);
router.post('/kyc/upload/cpf',         auth, kycCtrl.uploadMiddleware, kycCtrl.uploadCPF);
router.post('/kyc/upload/comprovante', auth, kycCtrl.uploadMiddleware, kycCtrl.uploadComprovante);
router.get('/kyc/status',              auth, kycCtrl.statusKYC);
router.get('/kyc/documentos',          auth, kycCtrl.statusDocumentos);
router.post('/kyc/login/iniciar',      kycCtrl.iniciarLoginBiometrico);
router.post('/kyc/login/confirmar',    kycCtrl.confirmarLoginBiometrico);
router.post('/webhooks/celcoin-kyc',   kycCtrl.webhookKYC);

══════════════════════════════════════════════════════════
DEPENDÊNCIAS — rode no backend:
npm install multer form-data
══════════════════════════════════════════════════════════
*/
