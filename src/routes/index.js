const express = require('express');
const router = express.Router();

const authCtrl = require('../controllers/authController');
const loanCtrl = require('../controllers/loanController');
const investorCtrl = require('../controllers/investorController');
const adminCtrl = require('../controllers/adminController');
const { auth, adminOnly, investorOnly, borrowerOnly } = require('../middleware/auth');

// Auth
router.post('/auth/register', authCtrl.register);
router.post('/auth/login', authCtrl.login);
router.get('/auth/me', auth, authCtrl.me);

// Empréstimos
router.post('/loans', auth, borrowerOnly, loanCtrl.createLoan);
router.get('/loans/code/:code', auth, investorOnly, loanCtrl.getByCode);
router.post('/loans/fund', auth, investorOnly, loanCtrl.fundLoan);
router.get('/loans/mine', auth, loanCtrl.myLoans);
router.get('/loans/:id', auth, loanCtrl.getLoanDetail);
router.post('/loans/pay', auth, loanCtrl.payInstallment);

// Investidor
router.get('/investor/dashboard', auth, investorOnly, investorCtrl.dashboard);
router.get('/investor/extrato', auth, investorOnly, investorCtrl.extrato);
router.post('/investor/deposit', auth, investorOnly, investorCtrl.deposit);
router.post('/investor/withdraw', auth, investorOnly, investorCtrl.withdraw);

// Admin
router.get('/admin/dashboard', auth, adminOnly, adminCtrl.dashboard);
router.get('/admin/loans', auth, adminOnly, adminCtrl.getAllLoans);
router.get('/admin/users', auth, adminOnly, adminCtrl.getAllUsers);
router.patch('/admin/users/:id/toggle', auth, adminOnly, adminCtrl.toggleUser);
router.get('/admin/config', auth, adminOnly, adminCtrl.getConfig);
router.put('/admin/config', auth, adminOnly, adminCtrl.updateConfig);
router.patch('/admin/loans/:id/cancel', auth, adminOnly, adminCtrl.cancelLoan);

module.exports = router;

// Conta do tomador
const borrowerCtrl = require('../controllers/borrowerController');
router.get('/borrower/dashboard',       auth, borrowerOnly, borrowerCtrl.dashboard);
router.get('/borrower/emprestimos',     auth, borrowerOnly, borrowerCtrl.meusEmprestimos);
router.get('/borrower/emprestimos/:id', auth, borrowerOnly, borrowerCtrl.detalheEmprestimo);
router.post('/borrower/pix-parcela',    auth, borrowerOnly, borrowerCtrl.gerarPixParcela);
router.get('/borrower/extrato',         auth, borrowerOnly, borrowerCtrl.extrato);
router.post('/borrower/sacar',          auth, borrowerOnly, borrowerCtrl.sacar);

// Perfil do tomador para o investidor
const profileCtrl = require('../controllers/borrowerProfileController');
router.get('/borrower/perfil/:code',    auth, investorOnly, profileCtrl.perfilTomador);
