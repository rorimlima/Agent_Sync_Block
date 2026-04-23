import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';

/**
 * Exporta array de objetos para CSV e faz download
 * @param {Array} data - Array de objetos
 * @param {Array} columns - [{ key, label, format? }]
 * @param {string} filename - Nome do arquivo sem extensão
 */
export function exportToCSV(data, columns, filename) {
  if (!data.length) return;

  const header = columns.map(c => c.label).join(';');
  const rows = data.map(row =>
    columns.map(c => {
      let val = row[c.key];
      if (c.format === 'currency') val = formatCurrency(val);
      else if (c.format === 'date') val = formatDate(val);
      else if (c.format === 'datetime') val = formatDateTime(val);
      else val = val ?? '';
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(';')
  );

  const bom = '\uFEFF';
  const csv = bom + [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
