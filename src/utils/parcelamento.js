// ─── Utilitário de parcelamento multi-periodicidade ──────────────────────────

// Converte taxa mensal para o período escolhido
const taxaPorPeriodo = (taxaMensal, periodicidade) => {
  const t = parseFloat(taxaMensal) / 100;
  switch (periodicidade) {
    case 'daily':    return parseFloat((Math.pow(1 + t, 1/30) - 1).toFixed(6)); // taxa diária equivalente
    case 'weekly':   return parseFloat((Math.pow(1 + t, 1/4.333) - 1).toFixed(6)); // taxa semanal equivalente
    case 'biweekly': return parseFloat((Math.pow(1 + t, 1/2) - 1).toFixed(6)); // taxa quinzenal equivalente
    case 'monthly':  return t;
    default: return t;
  }
};

// Número de períodos em 30 dias (para converter "n meses" em períodos)
const periodosPor30Dias = { daily: 30, weekly: 4.333, biweekly: 2, monthly: 1 };

// Labels amigáveis
const labels = {
  daily:    { singular: 'dia',      plural: 'dias',     label: 'Diária',    abrev: 'd' },
  weekly:   { singular: 'semana',   plural: 'semanas',  label: 'Semanal',   abrev: 'sem' },
  biweekly: { singular: 'quinzena', plural: 'quinzenas',label: 'Quinzenal', abrev: 'qzn' },
  monthly:  { singular: 'mês',      plural: 'meses',    label: 'Mensal',    abrev: 'mês' },
};

// Calcula tudo que precisa para montar o contrato
const calcularParcelamento = ({
  valorSolicitado,
  taxaMensalPercent,   // taxa mensal negociada (ex: 20)
  numPeriodos,         // quantas parcelas no período escolhido
  periodicidade,       // 'daily' | 'weekly' | 'biweekly' | 'monthly'
  taxaEntradaPercent = 10,
  taxaPorParcela = 10,
}) => {
  const valor     = parseFloat(valorSolicitado);
  const taxaPeriodo = taxaPorPeriodo(taxaMensalPercent, periodicidade);

  // Taxa de entrada (Credigrupo)
  const taxaEntrada = parseFloat((valor * taxaEntradaPercent / 100).toFixed(2));

  // Juros total (price — amortização constante)
  // Fórmula: PMT = PV * i / (1 - (1+i)^-n)
  let valorParcela;
  if (taxaPeriodo === 0) {
    valorParcela = valor / numPeriodos;
  } else {
    valorParcela = valor * taxaPeriodo / (1 - Math.pow(1 + taxaPeriodo, -numPeriodos));
  }
  valorParcela = parseFloat(valorParcela.toFixed(2));

  const totalJuros    = parseFloat((valorParcela * numPeriodos - valor).toFixed(2));
  const totalContrato = parseFloat((valor + taxaEntrada + totalJuros).toFixed(2));
  const parcelaFinal  = parseFloat((valorParcela + taxaPorParcela).toFixed(2));

  // Equivalência mensal (para comparação)
  const taxaMensalEquiv = parseFloat((taxaMensalPercent).toFixed(4));

  return {
    valorSolicitado:  valor,
    taxaEntrada,
    totalJuros,
    totalContrato,
    valorParcela:     parcelaFinal,    // com taxa por parcela
    valorParcelaSemTaxa: valorParcela, // sem taxa por parcela
    numPeriodos,
    periodicidade,
    taxaPeriodo:      parseFloat((taxaPeriodo * 100).toFixed(4)),
    taxaMensalEquiv,
    label:            labels[periodicidade],
  };
};

// Gera as datas de vencimento conforme a periodicidade
const gerarDatasVencimento = (numPeriodos, periodicidade) => {
  const datas = [];
  const hoje = new Date();

  const intervaloDias = {
    daily:    1,
    weekly:   7,
    biweekly: 15,
    monthly:  null, // usa lógica de meses
  };

  for (let i = 1; i <= numPeriodos; i++) {
    const d = new Date(hoje);
    if (periodicidade === 'monthly') {
      d.setMonth(d.getMonth() + i);
    } else {
      d.setDate(d.getDate() + intervaloDias[periodicidade] * i);
    }
    datas.push(d.toISOString().split('T')[0]);
  }
  return datas;
};

// Valida os limites por periodicidade
const validarPeriodos = (numPeriodos, periodicidade) => {
  const limites = {
    daily:    { min: 1,  max: 90,  label: '1 a 90 dias' },
    weekly:   { min: 2,  max: 52,  label: '2 a 52 semanas' },
    biweekly: { min: 2,  max: 24,  label: '2 a 24 quinzenas' },
    monthly:  { min: 1,  max: 48,  label: '1 a 48 meses' },
  };
  const l = limites[periodicidade];
  if (!l) return { valid: false, error: 'Periodicidade inválida' };
  if (numPeriodos < l.min || numPeriodos > l.max) {
    return { valid: false, error: `Para parcelas ${labels[periodicidade]?.label?.toLowerCase()}: ${l.label}` };
  }
  return { valid: true };
};

module.exports = { calcularParcelamento, gerarDatasVencimento, validarPeriodos, labels, taxaPorPeriodo };
