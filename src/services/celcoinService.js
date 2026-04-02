const axios = require('axios');

// ─── Configuração ────────────────────────────────────────────────────────────
// Sandbox: https://sandbox.openfinance.celcoin.dev
// Produção: https://openfinance.celcoin.com.br
const BASE_URL = process.env.CELCOIN_ENV === 'production'
  ? 'https://openfinance.celcoin.com.br'
  : 'https://sandbox.openfinance.celcoin.dev';

const CLIENT_ID     = process.env.CELCOIN_CLIENT_ID;
const CLIENT_SECRET = process.env.CELCOIN_CLIENT_SECRET;

let tokenCache = { token: null, expiresAt: 0 };

// ─── Autenticação (token expira em 3600s, cache automático) ──────────────────
const getToken = async () => {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const res = await axios.post(`${BASE_URL}/v5/token`, new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
  }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

  tokenCache = {
    token:     res.data.access_token,
    expiresAt: Date.now() + (res.data.expires_in - 60) * 1000,
  };

  return tokenCache.token;
};

const celcoin = async (method, path, data = null) => {
  const token = await getToken();
  const res = await axios({
    method,
    url: `${BASE_URL}${path}`,
    data,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  return res.data;
};

// ─── 1. CONTA DIGITAL — abrir conta para o tomador ──────────────────────────
// Chamado quando tomador finaliza cadastro no app
// Retorna: { accountNumber, agency, documentNumber }
const abrirContaTomador = async ({
  cpf, nome, email, telefone, dataNascimento,
  cep, logradouro, numero, bairro, cidade, estado,
}) => {
  const payload = {
    documentNumber: cpf.replace(/\D/g, ''),
    name:           nome,
    email,
    phone:          telefone.replace(/\D/g, ''),
    birthDate:      dataNascimento, // "YYYY-MM-DD"
    address: {
      postalCode:   cep.replace(/\D/g, ''),
      street:       logradouro,
      number,
      neighborhood: bairro,
      city:         cidade,
      state:        estado,
    },
    // Tipo de conta: conta de pagamento (não precisa de CNPJ)
    accountType: 'PAYMENT_ACCOUNT',
  };

  const res = await celcoin('POST', '/v5/accounts', payload);

  // res.data contém: accountNumber, agency, holderName, documentNumber
  return {
    accountNumber: res.data.accountNumber,
    agency:        res.data.agency,
    holderName:    res.data.holderName,
    documentNumber: res.data.documentNumber,
  };
};

// ─── 2. PIX COPIA E COLA — investidor deposita saldo ────────────────────────
// Gera um QR Code PIX estático para o investidor depositar
// O investidor usa o app do banco dele para pagar o QR
const gerarPixDeposito = async ({ accountNumber, amount, descricao }) => {
  const payload = {
    amount,
    description:   descricao || 'Depósito Credigrupo',
    key:           process.env.CELCOIN_PIX_KEY, // Chave PIX da Credigrupo cadastrada na Celcoin
    accountNumber,
  };

  const res = await celcoin('POST', '/v5/transactions/pix/payment-collection', payload);

  // res contém: transactionId, qrCode (string copia e cola), qrCodeImage (base64)
  return {
    transactionId: res.transactionId,
    qrCode:        res.qrCode,        // string para "copia e cola"
    qrCodeImage:   res.qrCodeImage,   // base64 da imagem do QR code
    amount,
  };
};

// ─── 3. PIX SAÍDA — investidor saca saldo ───────────────────────────────────
// Transfere dinheiro para a chave PIX do investidor
const sacarParaInvestidor = async ({ amount, pixKey, pixKeyType, nome, cpf, descricao }) => {
  const payload = {
    amount,
    clientCode:    `saque_${Date.now()}`, // ID único seu para rastreamento
    initiationType: 'DICT',               // transferência via chave PIX
    paymentInformation: {
      key:     pixKey,
      keyType: pixKeyType, // 'CPF' | 'EMAIL' | 'PHONE' | 'EVP'
    },
    receiver: {
      name:           nome,
      documentNumber: cpf.replace(/\D/g, ''),
    },
    description: descricao || 'Saque Credigrupo',
  };

  const res = await celcoin('POST', '/v5/transactions/pix/payment', payload);

  // res contém: transactionId, status, endToEndId
  return {
    transactionId: res.transactionId,
    status:        res.status,        // 'PROCESSING' | 'APPROVED' | 'DENIED'
    endToEndId:    res.endToEndId,    // rastreamento Banco Central
  };
};

// ─── 4. PIX RECEBIMENTO DE PARCELA — tomador paga parcela ───────────────────
// Gera QR Code PIX para o tomador pagar uma parcela específica
const gerarPixParcela = async ({ loanId, installmentNumber, amount, borrowerName }) => {
  const payload = {
    amount,
    description:   `Parcela ${installmentNumber} - Empréstimo ${loanId}`,
    key:           process.env.CELCOIN_PIX_KEY,
    // expiresIn em segundos (ex: 3 dias = 259200)
    expiresIn:     259200,
    additionalInfo: [
      { name: 'Empréstimo', value: loanId },
      { name: 'Parcela',    value: String(installmentNumber) },
      { name: 'Tomador',    value: borrowerName },
    ],
  };

  const res = await celcoin('POST', '/v5/transactions/pix/payment-collection', payload);

  return {
    transactionId: res.transactionId,
    qrCode:        res.qrCode,
    qrCodeImage:   res.qrCodeImage,
    expiresAt:     new Date(Date.now() + 259200 * 1000).toISOString(),
  };
};

// ─── 5. WEBHOOK — Celcoin avisa quando PIX foi pago ─────────────────────────
// Configure a URL https://SEU_BACKEND/api/webhooks/celcoin na Celcoin
// Ela vai chamar essa rota quando qualquer PIX entrar na sua conta
const processarWebhook = (payload) => {
  // payload.event: 'PIX_PAYMENT_RECEIVED' | 'PIX_PAYMENT_SENT' | etc.
  // payload.transactionId: ID da transação
  // payload.amount: valor recebido
  // payload.description: descrição que você colocou ao gerar o QR

  const { event, transactionId, amount, description, endToEndId } = payload;

  return { event, transactionId, amount, description, endToEndId };
};

// ─── 6. CONSULTAR STATUS DE TRANSAÇÃO ───────────────────────────────────────
const consultarTransacao = async (transactionId) => {
  const res = await celcoin('GET', `/v5/transactions/${transactionId}`);
  return {
    transactionId: res.transactionId,
    status:        res.status,
    amount:        res.amount,
    createdAt:     res.createdAt,
  };
};

// ─── 7. CONSULTAR SALDO DA CONTA CREDIGRUPO ─────────────────────────────────
const consultarSaldo = async () => {
  const res = await celcoin('GET', '/v5/accounts/balance');
  return {
    available: res.available,
    blocked:   res.blocked,
    total:     res.available + res.blocked,
  };
};

module.exports = {
  abrirContaTomador,
  gerarPixDeposito,
  sacarParaInvestidor,
  gerarPixParcela,
  processarWebhook,
  consultarTransacao,
  consultarSaldo,
};
