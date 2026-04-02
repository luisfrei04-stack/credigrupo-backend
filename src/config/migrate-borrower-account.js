const pool = require('./db');

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Garante que tomador também tem saldo rastreado na plataforma
      -- (campo balance já existe na tabela users)

      -- Tipo de transação para recebimento de empréstimo
      -- Garante que o campo type suporta 'loan_received'
      ALTER TABLE transactions
        DROP CONSTRAINT IF EXISTS transactions_type_check;

      -- Índice para busca de transações por tipo
      CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
      CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, created_at DESC);
    `);
    console.log('✅ Migration conta tomador concluída!');
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
const borrowerCtrl = require('../controllers/borrowerController');

router.get('/borrower/dashboard',          auth, borrowerOnly, borrowerCtrl.dashboard);
router.get('/borrower/emprestimos',        auth, borrowerOnly, borrowerCtrl.meusEmprestimos);
router.get('/borrower/emprestimos/:id',    auth, borrowerOnly, borrowerCtrl.detalheEmprestimo);
router.post('/borrower/pix-parcela',       auth, borrowerOnly, borrowerCtrl.gerarPixParcela);
router.get('/borrower/extrato',            auth, borrowerOnly, borrowerCtrl.extrato);

══════════════════════════════════════════════════════════
TAMBÉM: no loanController.js → fundLoan
Quando o investidor libera, registre a transação do tomador:
══════════════════════════════════════════════════════════
await client.query(
  'INSERT INTO transactions (user_id,type,amount,description,loan_id) VALUES ($1,$2,$3,$4,$5)',
  [loan.borrower_id, 'loan_received', loan.amount_requested, `Empréstimo recebido ${loan.code}`, loan.id]
);
══════════════════════════════════════════════════════════
*/
