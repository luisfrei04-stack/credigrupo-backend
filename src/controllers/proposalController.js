const db = require('../config/db');
const { notify } = require('../services/notificationService');
const { calcularParcelamento, gerarDatasVencimento, validarPeriodos, labels } = require('../utils/parcelamento');

exports.propostaInvestidor = async (req, res) => {
  const { code, taxa_proposta, periodicidade, num_periodos } = req.body;
  const investorId = req.user.id;

  if (!code || !taxa_proposta || !periodicidade || !num_periodos)
    return res.status(400).json({ error: 'Código, taxa, periodicidade e períodos são obrigatórios' });

  if (!['daily','weekly','biweekly','monthly'].includes(periodicidade))
    return res.status(400).json({ error: 'Periodicidade inválida' });

  const valida = validarPeriodos(num_periodos, periodicidade);
  if (!valida.valid) return res.status(400).json({ error: valida.error });

  try {
    const { rows: [loan] } = await db.query(
      `SELECT l.*, u.name as borrower_name, u.phone as borrower_phone,
              u.push_token as borrower_push, u.id as borrower_id
       FROM loans l JOIN users u ON l.borrower_id=u.id WHERE l.code=$1`,
      [code.toUpperCase()]
    );
    if (!loan) return res.status(404).json({ error: 'Código inválido' });
    if (loan.status !== 'open') return res.status(400).json({ error: 'Empréstimo indisponível' });
    if (new Date() > new Date(loan.expires_at)) return res.status(400).json({ error: 'Código expirado' });
    if (loan.borrower_id === investorId) return res.status(400).json({ error: 'Você não pode financiar seu próprio empréstimo' });

    const { rows: [inv] } = await db.query('SELECT balance FROM users WHERE id=$1', [investorId]);
    if (parseFloat(inv.balance) < parseFloat(loan.amount_requested))
      return res.status(400).json({ error: 'Saldo insuficiente' });

    const { rows: [config] } = await db.query('SELECT * FROM platform_config WHERE id=1');

    const calc = calcularParcelamento({
      valorSolicitado:   loan.amount_requested,
      taxaMensalPercent: taxa_proposta,
      numPeriodos:       num_periodos,
      periodicidade,
      taxaEntradaPercent: config.taxa_entrada_percent,
      taxaPorParcela:    config.taxa_parcela_reais,
    });

    await db.query(
      "UPDATE loan_proposals SET status='cancelled' WHERE loan_id=$1 AND investor_id=$2 AND status='pending'",
      [loan.id, investorId]
    );

    const { rows: [proposta] } = await db.query(
      `INSERT INTO loan_proposals
         (loan_id,investor_id,taxa_proposta,periodicidade,num_periodos,amount_contract,installment_value,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()+INTERVAL '24 hours') RETURNING *`,
      [loan.id, investorId, taxa_proposta, periodicidade, num_periodos, calc.totalContrato, calc.valorParcela]
    );

    await notify({
      user: { id: loan.borrower_id, name: loan.borrower_name?.split(' ')[0], phone: loan.borrower_phone, push_token: loan.borrower_push },
      title: 'Nova proposta de empréstimo!',
      message: `Proposta de ${taxa_proposta}% a.m. com parcelas ${labels[periodicidade].label.toLowerCase()}s (${num_periodos}x de R$${calc.valorParcela}). Abra o app!`,
      whatsappTemplate: 'credigrupo_proposta_juros',
      whatsappParams: [loan.borrower_name?.split(' ')[0], `${taxa_proposta}%`, `R$ ${loan.amount_requested}`],
      pushData: { screen: 'LoanProposal', proposalId: proposta.id },
    });

    res.json({ proposalId: proposta.id, ...calc, periodoLabel: labels[periodicidade].label, expiresAt: proposta.expires_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao enviar proposta' });
  }
};

exports.listarPropostas = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.*, l.code, l.amount_requested, i.name as investor_name
       FROM loan_proposals p
       JOIN loans l ON p.loan_id=l.id
       JOIN users i ON p.investor_id=i.id
       WHERE l.borrower_id=$1 AND p.status='pending' AND p.expires_at>NOW()
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json(rows.map(p => ({ ...p, periodoLabel: labels[p.periodicidade]?.label })));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar propostas' });
  }
};

exports.aceitarProposta = async (req, res) => {
  const { proposal_id } = req.body;
  const borrowerId = req.user.id;
  try {
    const { rows } = await db.query(
      `SELECT p.*, l.borrower_id, l.amount_requested, l.code,
              i.name as investor_name, i.phone as investor_phone, i.push_token as investor_push
       FROM loan_proposals p JOIN loans l ON p.loan_id=l.id
       JOIN users i ON p.investor_id=i.id
       WHERE p.id=$1 AND p.status='pending' AND p.expires_at>NOW()`,
      [proposal_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Proposta não encontrada ou expirada' });
    const p = rows[0];
    if (p.borrower_id !== borrowerId) return res.status(403).json({ error: 'Acesso negado' });

    const datas = gerarDatasVencimento(p.num_periodos, p.periodicidade);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE loans SET investor_id=$1,interest_rate=$2,amount_contract=$3,
         installment_value=$4,periodicidade=$5,num_periodos=$6,status='active',funded_at=NOW() WHERE id=$7`,
        [p.investor_id,p.taxa_proposta,p.amount_contract,p.installment_value,p.periodicidade,p.num_periodos,p.loan_id]
      );
      for (let i = 0; i < datas.length; i++) {
        await client.query(
          'INSERT INTO repayments (loan_id,installment_number,due_date,amount,taxa_parcela) VALUES ($1,$2,$3,$4,$5)',
          [p.loan_id, i+1, datas[i], p.installment_value, 10]
        );
      }
      await client.query("UPDATE loan_proposals SET status='cancelled' WHERE loan_id=$1 AND id!=$2",[p.loan_id,proposal_id]);
      await client.query("UPDATE loan_proposals SET status='accepted' WHERE id=$1",[proposal_id]);
      await client.query('UPDATE users SET balance=balance-$1 WHERE id=$2',[p.amount_requested,p.investor_id]);
      await client.query('UPDATE users SET balance=balance+$1 WHERE id=$2',[p.amount_requested,borrowerId]);
      await client.query('INSERT INTO transactions (user_id,type,amount,description,loan_id) VALUES ($1,$2,$3,$4,$5)',
        [p.investor_id,'invest',p.amount_requested,`Investimento ${p.code}`,p.loan_id]);
      await client.query('COMMIT');

      await notify({
        user: { id: p.investor_id, phone: p.investor_phone, push_token: p.investor_push },
        title: 'Proposta aceita!',
        message: `Empréstimo ${p.code} aceito! Parcelas ${labels[p.periodicidade]?.label?.toLowerCase()}s a partir de ${datas[0]}.`,
        pushData: { screen: 'LoanDetail', loanId: p.loan_id },
      });

      res.json({ success: true, message: 'Proposta aceita! Dinheiro liberado.', primeiraParcela: datas[0], periodoLabel: labels[p.periodicidade]?.label });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally { client.release(); }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao aceitar proposta' });
  }
};

exports.recusarProposta = async (req, res) => {
  const { proposal_id } = req.body;
  try {
    const { rows } = await db.query(
      `SELECT p.*, l.borrower_id, l.code, i.phone as investor_phone, i.push_token as investor_push
       FROM loan_proposals p JOIN loans l ON p.loan_id=l.id
       JOIN users i ON p.investor_id=i.id WHERE p.id=$1 AND p.status='pending'`,
      [proposal_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Proposta não encontrada' });
    const p = rows[0];
    if (p.borrower_id !== req.user.id) return res.status(403).json({ error: 'Acesso negado' });
    await db.query("UPDATE loan_proposals SET status='rejected' WHERE id=$1",[proposal_id]);
    await notify({ user: { id: p.investor_id, phone: p.investor_phone, push_token: p.investor_push },
      title: 'Proposta recusada', message: `Proposta para ${p.code} foi recusada.`, pushData: { screen: 'Invest' } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro ao recusar proposta' }); }
};
