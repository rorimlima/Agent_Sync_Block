import { formatDateTime } from '@/lib/utils';

/**
 * Gera PDF corporativo de veículos bloqueados e parcialmente bloqueados
 * Organizado por setor (Financeiro / Documentação) com design sério e profissional
 */
export async function exportBloqueadosPDF(bloqueados, parciais) {
  const total = bloqueados.length + parciais.length;
  if (total === 0) { alert('Nenhum veículo bloqueado para exportar.'); return; }

  const jsPDFModule = await import('jspdf');
  const jsPDF = jsPDFModule.jsPDF || jsPDFModule.default;
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF('landscape', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const now = new Date().toLocaleString('pt-BR');
  const protocolo = `BLQ-${Date.now().toString(36).toUpperCase()}`;

  // =================== HEADER CORPORATIVO ===================
  const drawHeader = (subtitle) => {
    // Fundo escuro corporativo
    doc.setFillColor(10, 15, 30);
    doc.rect(0, 0, pageW, 34, 'F');

    // Linha de acento inferior
    doc.setFillColor(220, 38, 38); // vermelho corporativo
    doc.rect(0, 34, pageW, 1.5, 'F');

    // Logo/sistema
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.text('AGENT SYNC BLOCK', 14, 14);

    // Subtítulo institucional
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 130, 150);
    doc.text('Sistema de Gestão e Controle de Veículos', 14, 20);

    // Título do documento
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text(subtitle.toUpperCase(), 14, 28);

    // Dados do relatório (lado direito)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(255, 255, 255);
    doc.text('RELATÓRIO DE BLOQUEIOS', pageW - 14, 14, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(120, 130, 150);
    doc.text(`Gerado em: ${now}`, pageW - 14, 20, { align: 'right' });
    doc.text(`Protocolo: ${protocolo}`, pageW - 14, 25, { align: 'right' });
    doc.text(`Classificação: USO INTERNO`, pageW - 14, 30, { align: 'right' });
  };

  // =================== FOOTER ===================
  const drawFooter = (pageNum, totalPages) => {
    doc.setFillColor(245, 247, 250);
    doc.rect(0, pageH - 12, pageW, 12, 'F');
    doc.setDrawColor(200, 210, 225);
    doc.line(0, pageH - 12, pageW, pageH - 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(120, 130, 150);
    doc.text('Agent Sync Block — Documento confidencial de uso interno. Reprodução não autorizada.', 14, pageH - 5);
    doc.text(`Página ${pageNum} de ${totalPages}`, pageW - 14, pageH - 5, { align: 'right' });
    doc.text(`Protocolo: ${protocolo}`, pageW / 2, pageH - 5, { align: 'center' });
  };

  // =================== RESUMO EXECUTIVO (Página 1) ===================
  drawHeader('Resumo Executivo');

  let y = 42;

  // Caixa de resumo
  doc.setFillColor(252, 252, 253);
  doc.setDrawColor(200, 210, 225);
  doc.roundedRect(14, y, pageW - 28, 28, 3, 3, 'FD');

  // Contadores
  const boxW = (pageW - 28) / 3;

  // Bloqueados
  doc.setFillColor(254, 226, 226);
  doc.roundedRect(18, y + 4, boxW - 8, 20, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(185, 28, 28);
  doc.text(String(bloqueados.length), 18 + (boxW - 8) / 2, y + 14, { align: 'center' });
  doc.setFontSize(7);
  doc.text('VEÍCULOS BLOQUEADOS', 18 + (boxW - 8) / 2, y + 20, { align: 'center' });

  // Parciais
  doc.setFillColor(254, 243, 199);
  doc.roundedRect(14 + boxW, y + 4, boxW - 4, 20, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(146, 64, 14);
  doc.text(String(parciais.length), 14 + boxW + (boxW - 4) / 2, y + 14, { align: 'center' });
  doc.setFontSize(7);
  doc.text('PARCIALMENTE BLOQUEADOS', 14 + boxW + (boxW - 4) / 2, y + 20, { align: 'center' });

  // Total
  doc.setFillColor(219, 234, 254);
  doc.roundedRect(14 + boxW * 2 + 4, y + 4, boxW - 8, 20, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(30, 64, 175);
  doc.text(String(total), 14 + boxW * 2 + 4 + (boxW - 8) / 2, y + 14, { align: 'center' });
  doc.setFontSize(7);
  doc.text('TOTAL REGISTROS', 14 + boxW * 2 + 4 + (boxW - 8) / 2, y + 20, { align: 'center' });

  y += 34;

  // Resumo por setor
  const finBloqueados = bloqueados.filter(b => b.status_financeiro === 'BLOQUEADO');
  const docBloqueados = bloqueados.filter(b => b.status_documentacao === 'BLOQUEADO');
  const finParciais = parciais.filter(b => b.status_financeiro === 'BLOQUEADO');
  const docParciais = parciais.filter(b => b.status_documentacao === 'BLOQUEADO');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text('DISTRIBUIÇÃO POR SETOR', 14, y + 4);
  y += 8;

  // Tabela de resumo por setor — jspdf-autotable v5: autoTable(doc, options)
  autoTable(doc, {
    startY: y,
    margin: { left: 14, right: 14 },
    head: [['Setor', 'Bloqueio Total', 'Bloqueio Parcial', 'Total Envolvidos']],
    body: [
      ['Financeiro', String(finBloqueados.length), String(finParciais.length), String(finBloqueados.length + finParciais.length)],
      ['Documentação', String(docBloqueados.length), String(docParciais.length), String(docBloqueados.length + docParciais.length)],
    ],
    styles: { fontSize: 8, cellPadding: 3, lineColor: [200, 210, 225], lineWidth: 0.3, textColor: [30, 41, 59], font: 'helvetica' },
    headStyles: { fillColor: [10, 15, 30], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, cellPadding: 4 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 1: { halign: 'center', fontStyle: 'bold', textColor: [185, 28, 28] }, 2: { halign: 'center', fontStyle: 'bold', textColor: [146, 64, 14] }, 3: { halign: 'center', fontStyle: 'bold' } },
  });

  // =================== VEÍCULOS BLOQUEADOS (Página 2+) ===================
  if (bloqueados.length > 0) {
    doc.addPage();
    drawHeader(`Veículos com Bloqueio Total — ${bloqueados.length} registros`);

    // Barra vermelha de alerta
    let startY = 40;
    doc.setFillColor(254, 226, 226);
    doc.setDrawColor(220, 38, 38);
    doc.roundedRect(14, startY, pageW - 28, 10, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(185, 28, 28);
    doc.text(`${bloqueados.length} VEICULO(S) COM BLOQUEIO TOTAL (FINANCEIRO + DOCUMENTACAO)`, pageW / 2, startY + 6.5, { align: 'center' });
    startY += 14;

    autoTable(doc, {
      startY,
      margin: { left: 14, right: 14 },
      head: [['#', 'Placa', 'Chassi', 'Marca/Modelo', 'Cliente', 'Financeiro', 'Documentação', 'Data Bloqueio']],
      body: bloqueados.map((b, i) => [
        String(i + 1),
        b.placa || '-',
        b.chassi || '-',
        b.marca_modelo || '-',
        b.razao_social || b.cod_cliente || '-',
        b.status_financeiro || '-',
        b.status_documentacao || '-',
        b.bloqueado_em ? formatDateTime(b.bloqueado_em) : '-',
      ]),
      styles: { fontSize: 7, cellPadding: 2.5, lineColor: [200, 210, 225], lineWidth: 0.2, textColor: [30, 41, 59], font: 'helvetica' },
      headStyles: { fillColor: [185, 28, 28], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5, cellPadding: 3 },
      alternateRowStyles: { fillColor: [254, 242, 242] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 8 },
        1: { fontStyle: 'bold', cellWidth: 22 },
        5: { halign: 'center', textColor: [185, 28, 28], fontStyle: 'bold' },
        6: { halign: 'center', textColor: [185, 28, 28], fontStyle: 'bold' },
      },
    });
  }

  // =================== VEÍCULOS PARCIAIS (Página seguinte) ===================
  if (parciais.length > 0) {
    doc.addPage();
    drawHeader(`Veículos com Bloqueio Parcial — ${parciais.length} registros`);

    let startY = 40;
    doc.setFillColor(254, 243, 199);
    doc.setDrawColor(202, 138, 4);
    doc.roundedRect(14, startY, pageW - 28, 10, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(146, 64, 14);
    doc.text(`${parciais.length} VEICULO(S) COM BLOQUEIO PARCIAL (APENAS 1 SETOR)`, pageW / 2, startY + 6.5, { align: 'center' });
    startY += 14;

    autoTable(doc, {
      startY,
      margin: { left: 14, right: 14 },
      head: [['#', 'Placa', 'Chassi', 'Marca/Modelo', 'Cliente', 'Financeiro', 'Documentação', 'Setor Pendente']],
      body: parciais.map((b, i) => {
        const pendente = b.status_financeiro !== 'BLOQUEADO' ? 'Financeiro' : 'Documentação';
        return [
          String(i + 1),
          b.placa || '-',
          b.chassi || '-',
          b.marca_modelo || '-',
          b.razao_social || b.cod_cliente || '-',
          b.status_financeiro || '-',
          b.status_documentacao || '-',
          pendente,
        ];
      }),
      styles: { fontSize: 7, cellPadding: 2.5, lineColor: [200, 210, 225], lineWidth: 0.2, textColor: [30, 41, 59], font: 'helvetica' },
      headStyles: { fillColor: [146, 64, 14], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5, cellPadding: 3 },
      alternateRowStyles: { fillColor: [254, 252, 232] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 8 },
        1: { fontStyle: 'bold', cellWidth: 22 },
        5: { halign: 'center' },
        6: { halign: 'center' },
        7: { halign: 'center', fontStyle: 'bold', textColor: [146, 64, 14] },
      },
    });
  }

  // =================== APLICAR FOOTERS EM TODAS AS PÁGINAS ===================
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(i, totalPages);
  }

  // Salvar
  doc.save(`relatorio_bloqueios_${new Date().toISOString().slice(0, 10)}.pdf`);
}
