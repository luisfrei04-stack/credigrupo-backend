const pool = require('./db');

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Salvar endereço do tomador durante o KYC para exibir ao investidor
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS address_street       VARCHAR(255),
        ADD COLUMN IF NOT EXISTS address_number       VARCHAR(20),
        ADD COLUMN IF NOT EXISTS address_neighborhood VARCHAR(100),
        ADD COLUMN IF NOT EXISTS address_city         VARCHAR(100),
        ADD COLUMN IF NOT EXISTS address_state        VARCHAR(2),
        ADD COLUMN IF NOT EXISTS address_zip          VARCHAR(10);

      -- Log de acessos ao perfil (LGPD — rastreabilidade)
      CREATE TABLE IF NOT EXISTS profile_access_log (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        investor_id  UUID REFERENCES users(id),
        borrower_id  UUID REFERENCES users(id),
        loan_code    VARCHAR(10),
        accessed_at  TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_profile_access_investor ON profile_access_log(investor_id);
      CREATE INDEX IF NOT EXISTS idx_profile_access_borrower ON profile_access_log(borrower_id);
    `);
    console.log('✅ Migration perfil tomador concluída!');
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
const profileCtrl = require('../controllers/borrowerProfileController');

// Investidor vê perfil do tomador ao digitar o código
router.get('/borrower/perfil/:code', auth, investorOnly, profileCtrl.perfilTomador);

══════════════════════════════════════════════════════════
TAMBÉM: no kycController.js → iniciarKYC
Salve o endereço quando o tomador preencher:
══════════════════════════════════════════════════════════
await db.query(
  `UPDATE users SET
     address_street=$1, address_number=$2, address_neighborhood=$3,
     address_city=$4, address_state=$5, address_zip=$6
   WHERE id=$7`,
  [logradouro, numero, bairro, cidade, estado, cep, userId]
);
══════════════════════════════════════════════════════════
*/
