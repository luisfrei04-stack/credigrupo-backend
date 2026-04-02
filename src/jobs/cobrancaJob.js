const db        = require('../config/db');
const { notify } = require('../services/notificationService');
const templates  = require('../services/notificationTemplates');

// Formata valor em BRL
const fBRL = (v) => 'R$ ' + parseFloat(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

// Formata data para exibição
const fData = (d) => new Date(d).toLocaleDateString('pt-BR');

// Registra disparo no banco para evitar duplicatas
const registrarDisparo = async (repaymentId, evento) => {
  await db.query(
    `INSERT INTO notification_log (repayment_id, evento, sent_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (repayment_id, evento) DO NOTHING`,
    [repaymentId, evento]
  );
};

// Verifica se já foi enviado hoje para evitar spam
const jaEnviado = async (repaymentId, evento) => {
  const res = await db.query(
    `SELECT id FROM notification_log
     WHERE repayment_id = $1 AND evento = $2
     AND sent_at > NOW() - INTERVAL '20 hours'`,
    [repaymentId, evento]
  );
  return res.rows.length > 0;
};

// ─── JOB PRINCIPAL ───────────────────────────────────────────────────────────
// Rode isso todo dia às 8h com node-cron ou Railway Cron Jobs
const runCobrancaJob = async () => {
  console.log(`[${new Date().toISOString()}] Iniciando régua de cobrança...`);
  let disparos = 0;

  try {
    // Busca todas as parcelas não pagas com empréstimo ativo
    const { rows: parcelas } = await db.query(`
      SELECT
        r.id, r.loan_id, r.installment_number, r.due_date, r.amount,
        l.status as loan_status,
        l.code as loan_code,
        b.id as borrower_id, b.name as borrower_name,
        b.phone as borrower_phone, b.push_token as borrower_push,
        CURRENT_DATE - r.due_date::date AS dias_atraso,
        r.due_date::date - CURRENT_DATE AS dias_ate_vencer
      FROM repayments r
      JOIN loans l ON r.loan_id = l.id
      JOIN users b ON l.borrower_id = b.id
      WHERE r.paid = false
        AND l.status IN ('active', 'late')
        AND b.active = true
      ORDER BY r.due_date ASC
    `);

    for (const p of parcelas) {
      const borrower = {
        id:    p.borrower_id,
        name:  p.borrower_name?.split(' ')[0],   // só primeiro nome
        phone: p.borrower_phone,
        push_token: p.borrower_push,
      };

      const dados = {
        nome:       borrower.name,
        valor:      fBRL(p.amount),
        vencimento: fData(p.due_date),
        codigo:     p.loan_code,
        parcela:    p.installment_number,
      };

      let evento = null;

      // Determina qual evento disparar com base nos dias
      if      (p.dias_ate_vencer === 3)  evento = 'antes_3dias';
      else if (p.dias_ate_vencer === 1)  evento = 'antes_1dia';
      else if (p.dias_ate_vencer === 0)  evento = 'dia_vencimento';
      else if (p.dias_atraso    === 1)   evento = 'atraso_1dia';
      else if (p.dias_atraso    === 3)   evento = 'atraso_3dias';
      else if (p.dias_atraso    === 7)   evento = 'atraso_7dias';
      else if (p.dias_atraso    === 15)  evento = 'atraso_15dias';

      if (!evento) continue;
      if (!templates[evento]) continue;

      // Verifica se já foi enviado (evita duplicata)
      if (await jaEnviado(p.id, evento)) continue;

      const tmpl = templates[evento];

      // Dispara notificação multi-canal
      await notify({
        user:              borrower,
        title:             tmpl.push.title,
        message:           tmpl.push.body(dados),
        whatsappTemplate:  tmpl.whatsapp?.template,
        whatsappParams:    tmpl.whatsapp?.params(dados),
        pushData: { repaymentId: p.id, loanId: p.loan_id, screen: 'Payment' },
      });

      // Atualiza status do empréstimo para 'late' se em atraso
      if (p.dias_atraso > 0 && p.loan_status === 'active') {
        await db.query("UPDATE loans SET status = 'late' WHERE id = $1", [p.loan_id]);
      }

      // Registra disparo
      await registrarDisparo(p.id, evento);
      disparos++;

      console.log(`  → ${evento} enviado para ${borrower.name} (parcela ${p.installment_number} - ${p.loan_code})`);
    }

    console.log(`[Cobrança] Concluído: ${disparos} notificações enviadas de ${parcelas.length} parcelas analisadas.`);
  } catch (err) {
    console.error('[Cobrança] Erro no job:', err.message);
  }
};

module.exports = { runCobrancaJob };
