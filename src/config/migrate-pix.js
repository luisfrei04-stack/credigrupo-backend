// Rode este arquivo para adicionar as colunas PIX ao banco existente
// Execute: node src/config/migrate-pix.js

const pool = require('./db');

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Campos de conta digital Celcoin no usuário
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS celcoin_account  VARCHAR(30),
        ADD COLUMN IF NOT EXISTS celcoin_agency   VARCHAR(10),
        ADD COLUMN IF NOT EXISTS pix_key          VARCHAR(255),
        ADD COLUMN IF NOT EXISTS pix_key_type     VARCHAR(20),
        ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMP DEFAULT NOW();

      -- Campo de status e ID externo nas transações
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS external_id VARCHAR(100),
        ADD COLUMN IF NOT EXISTS status      VARCHAR(20) DEFAULT 'completed';

      -- QR Code PIX nas parcelas
      ALTER TABLE repayments
        ADD COLUMN IF NOT EXISTS pix_qr         TEXT,
        ADD COLUMN IF NOT EXISTS pix_expires_at  TIMESTAMP;

      CREATE INDEX IF NOT EXISTS idx_transactions_external_id ON transactions(external_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_user_type ON transactions(user_id, type);
    `);

    console.log('✅ Migração PIX concluída!');
  } catch (err) {
    console.error('❌ Erro na migração PIX:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
};

migrate();
