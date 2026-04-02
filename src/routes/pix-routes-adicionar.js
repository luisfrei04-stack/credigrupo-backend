// ─── Adicione estas rotas ao seu src/routes/index.js existente ───────────────
// Cole o bloco abaixo dentro do arquivo de rotas, antes do module.exports

const pixController = require('../controllers/pixController');

// PIX e Conta Digital
// Tomador — abrir conta digital (chamado no cadastro)
router.post('/pix/conta', auth, borrowerOnly, pixController.abrirConta);

// Tomador — gerar QR Code PIX para pagar parcela
router.post('/pix/parcela', auth, borrowerOnly, pixController.gerarPixParcela);

// Investidor — gerar QR Code PIX para depositar saldo
router.post('/pix/deposito', auth, investorOnly, pixController.gerarDeposito);

// Investidor — sacar saldo via PIX
router.post('/pix/saque', auth, investorOnly, pixController.solicitarSaque);

// Webhook da Celcoin — NÃO tem autenticação JWT (Celcoin chama diretamente)
// Configure esta URL no painel da Celcoin: https://SEU_BACKEND/api/webhooks/celcoin
router.post('/webhooks/celcoin', pixController.webhook);
