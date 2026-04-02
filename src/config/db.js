const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
});

pool.on('error', (err) => {
  console.error('PostgreSQL error:', err.message);
});

module.exports = pool;
```

4. Clica **"Commit changes"**

---

**Enquanto isso, no Railway:**

1. Clica em **"observant flexibility"** (PostgreSQL)
2. Aba **"Variables"**
3. Me manda o início da `DATABASE_PUBLIC_URL` — só até o `@` — assim:
```
postgresql://postgres:senha@XXXX
