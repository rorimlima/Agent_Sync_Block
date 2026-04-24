import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';

/**
 * Gera e baixa um PDF técnico com cabeçalho profissional
 * Usa canvas/DOM para gerar PDF sem dependências externas
 * @param {Array} data - Array de objetos
 * @param {Array} columns - [{ key, label, format?, width? }]
 * @param {string} title - Título do relatório
 * @param {string} filename - Nome do arquivo
 * @param {Object} meta - Metadados opcionais { subtitle, filters, totalLabel, totalValue }
 */
export async function exportToPDF(data, columns, title, filename, meta = {}) {
  if (!data.length) return;

  // Importar jsPDF dinamicamente
  const { jsPDF } = await import('jspdf');
  await import('jspdf-autotable');

  const doc = new jsPDF('landscape', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // ========== HEADER TÉCNICO ==========
  const headerH = 32;

  // Fundo do header — gradiente simulado com retângulos
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageW, headerH, 'F');
  doc.setFillColor(30, 41, 59); // slate-800
  doc.rect(0, headerH - 2, pageW, 2, 'F');

  // Linha de acento
  doc.setFillColor(99, 102, 241); // indigo-500
  doc.rect(0, headerH - 1, pageW, 1, 'F');

  // Logo/Nome do sistema
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text('AGENT SYNC BLOCK', 12, 13);

  // Subtítulo do sistema
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184); // slate-400
  doc.text('Sistema de Gestão Integrada', 12, 19);

  // Título do relatório (lado direito)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text(title.toUpperCase(), pageW - 12, 13, { align: 'right' });

  // Data/hora geração
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  const now = new Date().toLocaleString('pt-BR');
  doc.text(`Gerado em: ${now}`, pageW - 12, 19, { align: 'right' });

  // Protocolo
  const protocolo = `RPT-${Date.now().toString(36).toUpperCase()}`;
  doc.text(`Protocolo: ${protocolo}`, pageW - 12, 24, { align: 'right' });

  // Subtítulo/filtros
  if (meta.subtitle) {
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(meta.subtitle, 12, 25);
  }

  // Total registros
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(`Total de registros: ${data.length}`, 12, 29);

  // ========== INFO BAR (abaixo do header) ==========
  let startY = headerH + 4;
  if (meta.totalLabel && meta.totalValue) {
    doc.setFillColor(254, 242, 242); // red-50
    doc.roundedRect(10, startY, pageW - 20, 10, 2, 2, 'F');
    doc.setDrawColor(239, 68, 68); // red-500
    doc.roundedRect(10, startY, pageW - 20, 10, 2, 2, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(185, 28, 28); // red-700
    doc.text(`${meta.totalLabel}: ${meta.totalValue}`, pageW / 2, startY + 6.5, { align: 'center' });
    startY += 14;
  }

  if (meta.filters) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`Filtros: ${meta.filters}`, 12, startY + 2);
    startY += 6;
  }

  // ========== TABELA ==========
  const formatVal = (row, col) => {
    let val = row[col.key];
    if (col.format === 'currency') return formatCurrency(val);
    if (col.format === 'date') return formatDate(val);
    if (col.format === 'datetime') return formatDateTime(val);
    return val ?? '';
  };

  const tableData = data.map(row =>
    columns.map(col => String(formatVal(row, col)))
  );

  doc.autoTable({
    head: [columns.map(c => c.label)],
    body: tableData,
    startY: startY + 1,
    margin: { left: 10, right: 10 },
    styles: {
      fontSize: 7,
      cellPadding: 2.5,
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      textColor: [30, 41, 59],
      font: 'helvetica',
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
      cellPadding: 3,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: columns.reduce((acc, col, i) => {
      if (col.format === 'currency') acc[i] = { halign: 'right', fontStyle: 'bold' };
      if (col.align === 'center') acc[i] = { ...acc[i], halign: 'center' };
      return acc;
    }, {}),
    didDrawPage: (data) => {
      // Footer em cada página
      const pageCount = doc.internal.getNumberOfPages();
      doc.setFillColor(248, 250, 252);
      doc.rect(0, pageH - 10, pageW, 10, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.line(0, pageH - 10, pageW, pageH - 10);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6);
      doc.setTextColor(148, 163, 184);
      doc.text('Agent Sync Block — Documento gerado automaticamente. Uso interno.', 12, pageH - 4);
      doc.text(`Página ${data.pageNumber} de ${pageCount}`, pageW - 12, pageH - 4, { align: 'right' });
    },
  });

  // Salvar
  doc.save(`${filename}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
