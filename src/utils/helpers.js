const gerarCodigo = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let codigo = 'CRD-';
  for (let i = 0; i < 4; i++) {
    codigo += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return codigo;
};

const formatCPF = (cpf) => cpf.replace(/\D/g, '');

const validarCPF = (cpf) => {
  cpf = formatCPF(cpf);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1+$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
  let rev = 11 - (sum % 11);
  if (rev >= 10) rev = 0;
  if (rev !== parseInt(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
  rev = 11 - (sum % 11);
  if (rev >= 10) rev = 0;
  return rev === parseInt(cpf[10]);
};

const calcularParcelas = (valorContrato, numParcelas, taxaParcela) => {
  const valorBase = valorContrato / numParcelas;
  const valorComTaxa = valorBase + parseFloat(taxaParcela);
  return parseFloat(valorComTaxa.toFixed(2));
};

const gerarDatasVencimento = (numParcelas) => {
  const datas = [];
  const hoje = new Date();
  for (let i = 1; i <= numParcelas; i++) {
    const data = new Date(hoje);
    data.setMonth(data.getMonth() + i);
    datas.push(data.toISOString().split('T')[0]);
  }
  return datas;
};

module.exports = { gerarCodigo, formatCPF, validarCPF, calcularParcelas, gerarDatasVencimento };
