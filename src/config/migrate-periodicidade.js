const pool = require('./db');

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Periodicidade nos empréstimos
      ALTER TABLE loans
        ADD COLUMN IF NOT EXISTS periodicidade   VARCHAR(20) DEFAULT 'monthly',
        ADD COLUMN IF NOT EXISTS num_periodos    INTEGER;

      -- Periodicidade nas propostas
      ALTER TABLE loan_proposals
        ADD COLUMN IF NOT EXISTS periodicidade   VARCHAR(20) DEFAULT 'monthly',
        ADD COLUMN IF NOT EXISTS num_periodos    INTEGER;

      -- Índice para busca por periodicidade
      CREATE INDEX IF NOT EXISTS idx_loans_periodicidade ON loans(periodicidade);
    `);
    console.log('✅ Migration periodicidade concluída!');
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
router.post('/proposals/propor',   auth, investorOnly, proposalCtrl.propostaInvestidor);
router.get('/proposals/minhas',    auth, borrowerOnly, proposalCtrl.listarPropostas);
router.post('/proposals/aceitar',  auth, borrowerOnly, proposalCtrl.aceitarProposta);
router.post('/proposals/recusar',  auth, borrowerOnly, proposalCtrl.recusarProposta);

══════════════════════════════════════════════════════════
DEPENDÊNCIAS — rode no backend:
npm install node-cron twilio
══════════════════════════════════════════════════════════
*/
