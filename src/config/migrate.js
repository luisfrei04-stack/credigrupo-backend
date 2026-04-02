const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        cpf VARCHAR(14) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(20),
        password_hash VARCHAR(255) NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('investor', 'borrower', 'admin')),
        balance DECIMAL(12,2) DEFAULT 0,
        pix_key VARCHAR(255),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS loans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(10) UNIQUE NOT NULL,
        borrower_id UUID REFERENCES users(id),
        investor_id UUID REFERENCES users(id),
        amount_requested DECIMAL(12,2) NOT NULL,
        amount_contract DECIMAL(12,2) NOT NULL,
        taxa_entrada DECIMAL(12,2) NOT NULL,
        installments INTEGER NOT NULL,
        installment_value DECIMAL(12,2) NOT NULL,
        interest_rate DECIMAL(5,2) DEFAULT 20,
        status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','funded','active','late','completed','cancelled')),
        funded_at TIMESTAMP,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS repayments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        loan_id UUID REFERENCES loans(id),
        installment_number INTEGER NOT NULL,
        due_date DATE NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        taxa_parcela DECIMAL(12,2) DEFAULT 10,
        paid BOOLEAN DEFAULT false,
        paid_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        type VARCHAR(30) NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        description VARCHAR(255),
        loan_id UUID REFERENCES loans(id),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS platform_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        taxa_entrada_percent DECIMAL(5,2) DEFAULT 10,
        taxa_parcela_reais DECIMAL(8,2) DEFAULT 10,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      INSERT INTO platform_config (id, taxa_entrada_percent, taxa_parcela_reais)
      VALUES (1, 10, 10)
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log('✅ Banco de dados migrado com sucesso!');
  } catch (err) {
    console.error('❌ Erro na migração:', err);
  } finally {
    client.release();
    await pool.end();
  }
};

if (require.main === module) migrate();

module.exports = pool;
