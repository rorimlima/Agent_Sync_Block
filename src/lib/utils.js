/**
 * Converte centavos para formato BRL (R$ 1.234,56)
 * @param {number} cents - Valor em centavos
 * @returns {string}
 */
export function formatCurrency(cents) {
  if (cents === null || cents === undefined) return 'R$ 0,00';
  const value = cents / 100;
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Converte valor decimal para centavos
 * @param {number|string} value - Valor decimal (ex: 10.50)
 * @returns {number} centavos
 */
export function toCents(value) {
  if (!value) return 0;
  return Math.round(parseFloat(String(value).replace(',', '.')) * 100);
}

/**
 * Formata data para pt-BR
 * @param {string} dateStr - Data ISO string
 * @returns {string}
 */
export function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('pt-BR');
}

/**
 * Formata data e hora para pt-BR
 * @param {string} dateStr - Data ISO string com hora
 * @returns {string}
 */
export function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('pt-BR');
}

/**
 * Retorna a classe CSS do badge de alerta
 * @param {string} status - Status de alerta
 * @returns {string}
 */
export function getAlertBadgeClass(status) {
  const map = {
    'EMERGENCIA': 'badge-emergencia',
    'ATENCAO': 'badge-atencao',
    'LEMBRETE': 'badge-lembrete',
    'NORMAL': 'badge-normal',
  };
  return map[status] || 'badge-normal';
}

/**
 * Retorna emoji do status de alerta
 */
export function getAlertEmoji(status) {
  const map = {
    'EMERGENCIA': '🔴',
    'ATENCAO': '🟠',
    'LEMBRETE': '🟡',
    'NORMAL': '🟢',
  };
  return map[status] || '⚪';
}

/**
 * Retorna label legível do status
 */
export function getAlertLabel(status) {
  const map = {
    'EMERGENCIA': 'Emergência',
    'ATENCAO': 'Atenção',
    'LEMBRETE': 'Lembrete',
    'NORMAL': 'Normal',
  };
  return map[status] || status;
}

/**
 * CN utility para classes condicionais
 */
export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}
