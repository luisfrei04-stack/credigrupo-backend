const axios = require('axios');

// ─── Configuração ────────────────────────────────────────────────────────────
// Sandbox: https://sandbox.dev.mova.vc
// Produção: https://api.mova.vc
const BASE_URL = process.env.MOVA_ENV === 'production'
  ? 'https://api.mova.vc'
  : 'https://sandbox.dev.mova.vc';

// Credenciais fornecidas pela Mova após assinatura do contrato
const API_KEY       = process.env.MOVA_API_KEY;
const CLIENT_ID     = process.env.MOVA_CLIENT_ID;
const PRODUCT_ID    = process.env.MOVA_PRODUCT_ID;

// Headers padrão exigidos pela Mova em todas as requisições
const headers = () => ({
  'api-key':         API_KEY,
  'mova-client-id':  CLIENT_ID,
  'Content-Type':    'application/json',
});

const mova = async (method, path, data = null) => {
  try {
    const res = await axios({ method, url: `${BASE_URL}${path}`, data, headers: headers() });
    return res.data;
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    throw new Error(`Mova API error: ${msg}`);
  }
};

// ─── 1. CRIAR COTAÇÃO ────────────────────────────────────────────────────────
// Primeiro passo: envia os dados do empréstimo para a Mova calcular e validar
// Chamado logo após o investidor liberar o empréstimo
const criarCotacao = async ({
  valorSolicitado,    // valor que o tomador recebe
  valorContrato,      // valor total do contrato (com taxa de entrada)
  taxaMensal,         // 20 (em %)
  numParcelas,        // 12
  valorParcela,       // valor de cada parcela
  // Dados do tomador
  tomadorCpf, tomadorNome, tomadorEmail, tomadorNascimento,
  // Dados do investidor
  investidorCpf, investidorNome, investidorEmail,
}) => {
  const payload = {
    product_id: PRODUCT_ID,
    loan: {
      requested_amount:  valorSolicitado,
      total_amount:      valorContrato,
      interest_rate:     taxaMensal,
      installments:      numParcelas,
      installment_value: valorParcela,
      currency:          'BRL',
    },
    borrower: {
      document_number: tomadorCpf.replace(/\D/g, ''),
      name:            tomadorNome,
      email:           tomadorEmail,
      birth_date:      tomadorNascimento, // "YYYY-MM-DD"
      person_type:     'NATURAL',         // pessoa física
    },
    investor: {
      document_number: investidorCpf.replace(/\D/g, ''),
      name:            investidorNome,
      email:           investidorEmail,
      person_type:     'NATURAL',
    },
  };

  const res = await mova('POST', '/v1/quotations', payload);

  // Retorna: { quotation_id, status, ccb_number }
  return {
    quotationId: res.quotation_id,
    status:      res.status,
    ccbNumber:   res.ccb_number,
  };
};

// ─── 2. CRIAR PROPOSTA (gera CCB e links de assinatura) ─────────────────────
// Segundo passo: transforma a cotação em proposta formal com CCB
const criarProposta = async (quotationId) => {
  const res = await mova('POST', `/v1/quotations/${quotationId}/proposals`, {
    product_id: PRODUCT_ID,
  });

  // Retorna: { proposal_id, ccb_url (PDF), signature_link_borrower, signature_link_investor }
  return {
    proposalId:             res.proposal_id,
    ccbUrl:                 res.ccb_url,                  // PDF da CCB para visualizar
    signatureLinkBorrower:  res.signature_link_borrower,  // link para tomador assinar
    signatureLinkInvestor:  res.signature_link_investor,  // link para investidor assinar
    status:                 res.status,
  };
};

// ─── 3. CONSULTAR STATUS DA PROPOSTA ────────────────────────────────────────
// Verifica se as partes já assinaram
const consultarProposta = async (proposalId) => {
  const res = await mova('GET', `/v1/proposals/${proposalId}`);

  return {
    proposalId:         res.proposal_id,
    status:             res.status,
    // 'PENDING' | 'BORROWER_SIGNED' | 'INVESTOR_SIGNED' | 'FULLY_SIGNED' | 'CANCELLED'
    borrowerSigned:     res.borrower_signed,
    investorSigned:     res.investor_signed,
    ccbUrl:             res.ccb_url,
    ccbSignedUrl:       res.ccb_signed_url, // PDF final com assinaturas
    signedAt:           res.signed_at,
  };
};

// ─── 4. WEBHOOK — Mova avisa quando houver assinatura ───────────────────────
// Configure a URL https://SEU_BACKEND/api/webhooks/mova no painel da Mova
const processarWebhookMova = (payload) => {
  // Eventos possíveis:
  // 'proposal.borrower_signed'  — tomador assinou
  // 'proposal.investor_signed'  — investidor assinou
  // 'proposal.fully_signed'     — todos assinaram (CCB formalizada!)
  // 'proposal.cancelled'        — proposta cancelada
  return {
    event:      payload.event,
    proposalId: payload.proposal_id,
    ccbUrl:     payload.ccb_signed_url,
    signedAt:   payload.signed_at,
  };
};

// ─── 5. CANCELAR PROPOSTA ────────────────────────────────────────────────────
const cancelarProposta = async (proposalId, motivo) => {
  await mova('POST', `/v1/proposals/${proposalId}/cancel`, { reason: motivo });
  return { success: true };
};

module.exports = {
  criarCotacao,
  criarProposta,
  consultarProposta,
  processarWebhookMova,
  cancelarProposta,
};
