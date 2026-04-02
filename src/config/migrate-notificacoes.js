const pool = require('./db');

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Tabela de propostas de juros (investidor → tomador)
      CREATE TABLE IF NOT EXISTS loan_proposals (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        loan_id          UUID REFERENCES loans(id),
        investor_id      UUID REFERENCES users(id),
        taxa_proposta    DECIMAL(5,2) NOT NULL,
        amount_contract  DECIMAL(12,2) NOT NULL,
        installment_value DECIMAL(12,2) NOT NULL,
        status           VARCHAR(20) DEFAULT 'pending',
        expires_at       TIMESTAMP,
        created_at       TIMESTAMP DEFAULT NOW()
      );

      -- Evitar múltiplas propostas ativas do mesmo investidor para o mesmo empréstimo
      CREATE UNIQUE INDEX IF NOT EXISTS idx_proposals_unique_pending
        ON loan_proposals(loan_id, investor_id)
        WHERE status = 'pending';

      -- Log de notificações enviadas (evita duplicatas)
      CREATE TABLE IF NOT EXISTS notification_log (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        repayment_id  UUID REFERENCES repayments(id),
        evento        VARCHAR(30) NOT NULL,
        sent_at       TIMESTAMP DEFAULT NOW(),
        UNIQUE(repayment_id, evento)
      );

      -- Push token dos usuários (salvo pelo app mobile)
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS push_token VARCHAR(200);

      CREATE INDEX IF NOT EXISTS idx_proposals_loan    ON loan_proposals(loan_id);
      CREATE INDEX IF NOT EXISTS idx_proposals_investor ON loan_proposals(investor_id);
      CREATE INDEX IF NOT EXISTS idx_notif_log_rep     ON notification_log(repayment_id);
    `);
    console.log('✅ Migration notificações + propostas concluída!');
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
const proposalCtrl = require('../controllers/proposalController');

// Investidor propõe taxa
router.post('/proposals/propor',   auth, investorOnly, proposalCtrl.propostaInvestidor);

// Tomador vê e responde propostas
router.get('/proposals/minhas',    auth, borrowerOnly, proposalCtrl.listarPropostas);
router.post('/proposals/aceitar',  auth, borrowerOnly, proposalCtrl.aceitarProposta);
router.post('/proposals/recusar',  auth, borrowerOnly, proposalCtrl.recusarProposta);

// Roda o job manualmente (útil para teste)
router.post('/admin/run-cobranca', auth, adminOnly, async (req, res) => {
  const { runCobrancaJob } = require('../jobs/cobrancaJob');
  await runCobrancaJob();
  res.json({ success: true });
});

// Salvar push token do usuário (chamado pelo app ao fazer login)
router.post('/users/push-token', auth, async (req, res) => {
  const { token } = req.body;
  await require('../config/db').query('UPDATE users SET push_token=$1 WHERE id=$2', [token, req.user.id]);
  res.json({ success: true });
});

══════════════════════════════════════════════════════════
VARIÁVEIS DE AMBIENTE (.env) — adicione
══════════════════════════════════════════════════════════
# WhatsApp (Meta Cloud API)
META_WHATSAPP_TOKEN=seu_token_permanente_meta
META_PHONE_NUMBER_ID=seu_phone_number_id

# SMS (Twilio)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=seu_auth_token
TWILIO_PHONE_NUMBER=+14155238886

# Suporte
SUPPORT_PHONE=(11) 99999-9999

══════════════════════════════════════════════════════════
DEPENDÊNCIAS — rode no backend:
npm install node-cron twilio
══════════════════════════════════════════════════════════

══════════════════════════════════════════════════════════
TEMPLATES WHATSAPP — registre no Meta Business Manager
══════════════════════════════════════════════════════════
Acesse: business.facebook.com → WhatsApp → Message Templates

Templates a registrar (categoria: UTILITY):
- credigrupo_lembrete_3dias    → params: {{1}}=nome, {{2}}=valor, {{3}}=vencimento
- credigrupo_lembrete_1dia     → params: {{1}}=nome, {{2}}=valor, {{3}}=vencimento
- credigrupo_vencimento_hoje   → params: {{1}}=nome, {{2}}=valor
- credigrupo_atraso_1dia       → params: {{1}}=nome, {{2}}=valor
- credigrupo_atraso_3dias      → params: {{1}}=nome, {{2}}=valor, {{3}}=dias
- credigrupo_atraso_7dias      → params: {{1}}=nome, {{2}}=valor, {{3}}=telefone_suporte
- credigrupo_atraso_15dias     → params: {{1}}=nome, {{2}}=valor, {{3}}=telefone_suporte
- credigrupo_proposta_juros    → params: {{1}}=nome, {{2}}=taxa, {{3}}=valor
- credigrupo_proposta_aceita   → params: {{1}}=nome, {{2}}=codigo, {{3}}=taxa

══════════════════════════════════════════════════════════
SERVER.JS — adicione os jobs no final do arquivo
══════════════════════════════════════════════════════════
const { iniciarJobs } = require('./src/jobs/scheduler');
iniciarJobs();
══════════════════════════════════════════════════════════
*/
