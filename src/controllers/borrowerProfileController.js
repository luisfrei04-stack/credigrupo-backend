const db = require('../config/db');

// ─── Perfil completo do tomador — acessado pelo investidor via código ─────────
// Chamado quando investidor digita o código CRD-XXXX
exports.perfilTomador = async (req, res) => {
  const { code } = req.params;
  const investorId = req.user.id;

  try {
    // Busca o empréstimo e os dados do tomador
    const { rows: [loan] } = await db.query(
      `SELECT l.id, l.code, l.amount_requested, l.installments,
              l.status, l.expires_at,
              u.id as borrower_id,
              u.name, u.cpf, u.email, u.phone,
              u.kyc_status,
              u.kyc_doc_rg_frente, u.kyc_doc_rg_verso,
              u.kyc_doc_cnh, u.kyc_doc_cpf,
              u.kyc_doc_residencia,
              u.kyc_onboarding_id,
              -- Endereço vem do KYC (salvo no onboarding)
              u.address_street, u.address_number, u.address_neighborhood,
              u.address_city, u.address_state, u.address_zip
       FROM loans l
       JOIN users u ON l.borrower_id = u.id
       WHERE l.code = $1`,
      [code.toUpperCase()]
    );

    if (!loan) return res.status(404).json({ error: 'Código inválido' });
    if (loan.status !== 'open') return res.status(400).json({ error: 'Empréstimo não disponível' });
    if (new Date() > new Date(loan.expires_at)) return res.status(400).json({ error: 'Código expirado' });
    if (loan.borrower_id === investorId) return res.status(400).json({ error: 'Você não pode financiar seu próprio empréstimo' });

    // Histórico de empréstimos do tomador (exceto o atual)
    const { rows: historico } = await db.query(
      `SELECT code, amount_requested, amount_contract, status,
              installments, periodicidade,
              funded_at, created_at,
              (SELECT COUNT(*) FROM repayments r WHERE r.loan_id=l.id AND r.paid=true) as pagas,
              (SELECT COUNT(*) FROM repayments r WHERE r.loan_id=l.id) as total
       FROM loans l
       WHERE borrower_id = $1 AND id != $2
       ORDER BY created_at DESC
       LIMIT 10`,
      [loan.borrower_id, loan.id]
    );

    // Estatísticas de comportamento
    const total       = historico.length;
    const concluidos  = historico.filter(h => h.status === 'completed').length;
    const atrasados   = historico.filter(h => h.status === 'late').length;
    const emAndamento = historico.filter(h => h.status === 'active').length;
    const taxaAtraso  = total > 0 ? ((atrasados / total) * 100).toFixed(0) : 0;

    // CPF mascarado: ***.456.789-**
    const cpfMascarado = loan.cpf
      ? loan.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '***.$2.$3-**')
      : null;

    res.json({
      // Dados do empréstimo
      emprestimo: {
        code:             loan.code,
        amountRequested:  loan.amount_requested,
        installments:     loan.installments,
      },
      // Perfil do tomador
      tomador: {
        nome:          loan.name,
        cpf:           cpfMascarado,
        email:         loan.email,
        telefone:      loan.phone,
        kycStatus:     loan.kyc_status,
        kycAprovado:   loan.kyc_status === 'APPROVED',
        // Endereço
        endereco: {
          logradouro: loan.address_street,
          numero:     loan.address_number,
          bairro:     loan.address_neighborhood,
          cidade:     loan.address_city,
          estado:     loan.address_state,
          cep:        loan.address_zip,
        },
        // IDs dos documentos Celcoin (URLs buscadas separadamente)
        documentos: {
          rgFrente:    loan.kyc_doc_rg_frente,
          rgVerso:     loan.kyc_doc_rg_verso,
          cnh:         loan.kyc_doc_cnh,
          cpfDoc:      loan.kyc_doc_cpf,
          residencia:  loan.kyc_doc_residencia,
          onboardingId: loan.kyc_onboarding_id,
        },
      },
      // Histórico e score
      historico: {
        total, concluidos, atrasados, emAndamento,
        taxaAtraso:      parseInt(taxaAtraso),
        scoreTexto:      scoreTexto(total, concluidos, atrasados),
        emprestimos:     historico,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar perfil do tomador' });
  }
};

// Score textual simples baseado no histórico
const scoreTexto = (total, concluidos, atrasados) => {
  if (total === 0) return { label: 'Novo cliente', cor: 'amber', desc: 'Sem histórico na Credigrupo' };
  if (atrasados === 0 && concluidos > 0) return { label: 'Excelente', cor: 'green', desc: 'Sem histórico de atrasos' };
  if (atrasados > 0 && atrasados / total < 0.2) return { label: 'Bom', cor: 'green', desc: 'Poucos atrasos registrados' };
  if (atrasados / total < 0.4) return { label: 'Regular', cor: 'amber', desc: 'Alguns atrasos no histórico' };
  return { label: 'Atenção', cor: 'red', desc: 'Alto índice de atrasos' };
};
