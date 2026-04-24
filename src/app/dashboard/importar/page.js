'use client';
import { useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { smartSyncVendas, smartSyncInadimplencia, fillMissingRazaoSocial } from '@/lib/smartSync';
import { useAuth } from '@/hooks/useAuth';
import { useRealtime } from '@/hooks/useRealtime';
import { Upload, Users, AlertTriangle, ShoppingCart, FileSpreadsheet, Check, X, Loader2, Clock, AlertCircle, RefreshCw } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';

export default function ImportarPage() {
  const { setor, user, hasRole } = useAuth();

  if (!hasRole(['master', 'financeiro'])) {
    return <div className="text-center py-20 text-text-muted">Acesso restrito</div>;
  }

  const { data: logs, refetch: refetchLogs } = useRealtime('import_logs', { orderBy: 'created_at', orderAsc: false });
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [importType, setImportType] = useState('');
  const [result, setResult] = useState(null);
  const [errors, setErrors] = useState([]);
  const fileRef = useRef(null);

  const IMPORT_TYPES = [
    { key: 'clientes', label: 'Importar Clientes', icon: Users, color: 'text-primary', bg: 'bg-primary/10' },
    { key: 'inadimplencia', label: 'Importar Inadimplência', icon: AlertTriangle, color: 'text-danger', bg: 'bg-danger/10' },
    { key: 'vendas', label: 'Importar Vendas', icon: ShoppingCart, color: 'text-success', bg: 'bg-success/10' },
  ];

  // Mapeamento flexível — aceita múltiplas variações de nomes de colunas
  const COL_MAP = {
    cod_cliente: ['cod_cliente', 'codigo', 'código', 'cod', 'id_cliente', 'cliente_id', 'id'],
    razao_social: ['razao_social', 'razão_social', 'nome', 'cliente', 'razao', 'nome_cliente', 'empresa'],
    cpf_cnpj: ['cpf_cnpj', 'cpf', 'cnpj', 'documento', 'doc', 'cpf/cnpj'],
    celular: ['celular', 'telefone', 'fone', 'tel', 'contato', 'whatsapp'],
    email: ['email', 'e-mail', 'e_mail'],
    endereco: ['endereco', 'endereço', 'rua', 'logradouro', 'endereco_completo'],
    cidade: ['cidade', 'municipio', 'município'],
    estado: ['estado', 'uf'],
    valor_devido: ['valor_devido', 'valor', 'valor_divida', 'saldo', 'saldo_devedor', 'total', 'valor_total'],
    data_vencimento: ['data_vencimento', 'vencimento', 'dt_vencimento', 'data_venc'],
    data_venda: ['data_venda', 'data', 'dt_venda', 'data_compra', 'notafiscal_dataemissao', 'data_emissao', 'dt_emissao'],
    placa: ['placa', 'placa_veiculo', 'veiculo_placauf', 'placauf'],
    chassi: ['chassi', 'veiculo_chassi', 'chassis', 'nr_chassi', 'num_chassi'],
    marca_modelo: ['marca_modelo', 'veiculo', 'veículo', 'modelo', 'descricao', 'descrição', 'marca', 'carro', 'veiculomodeloveiculo_descricao', 'modelo_veiculo'],
    valor_venda: ['valor_venda', 'valor', 'preco', 'preço', 'valor_total', 'total'],
  };

  const findCol = (row, aliases) => {
    const keys = Object.keys(row);
    for (const alias of aliases) {
      const found = keys.find(k => k.toLowerCase().trim() === alias.toLowerCase());
      if (found) return String(row[found] ?? '').trim();
    }
    return '';
  };

  const parseValor = (str) => {
    if (!str) return 0;
    const cleaned = String(str).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : Math.round(num * 100);
  };

  const parseDate = (val) => {
    if (!val) return null;
    // Se for número (serial do Excel)
    if (typeof val === 'number') {
      const date = new Date((val - 25569) * 86400 * 1000);
      if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
      return null;
    }
    const str = String(val).trim();
    // dd/mm/yyyy
    const brMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (brMatch) {
      const [, d, m, y] = brMatch;
      const year = y.length === 2 ? '20' + y : y;
      return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    // yyyy-mm-dd (já no formato)
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.split('T')[0];
    return null;
  };

  const handleFileSelect = (type) => {
    setImportType(type);
    setResult(null);
    setErrors([]);
    fileRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!data.length) {
        setResult({ success: false, message: 'Planilha vazia ou sem dados válidos' });
        return;
      }
      setPreview({ data, fileName: file.name, type: importType, columns: Object.keys(data[0]) });
    } catch (err) {
      setResult({ success: false, message: 'Erro ao ler arquivo: ' + err.message });
    }
  };

  const processImport = async () => {
    if (!preview) return;
    setImporting(true);
    setResult(null);
    setErrors([]);
    const errorList = [];
    let count = 0;
    let syncInfo = { inserted: 0, updated: 0 };
    const protocolo = crypto.randomUUID();

    try {
      const { data: rows, type } = preview;

      if (type === 'clientes') {
        const records = [];
        rows.forEach((row, i) => {
          const cod = findCol(row, COL_MAP.cod_cliente);
          const razao = findCol(row, COL_MAP.razao_social);
          if (!cod) { errorList.push(`Linha ${i + 2}: cod_cliente vazio — ignorada`); return; }
          records.push({
            cod_cliente: cod,
            razao_social: razao || `Cliente ${cod}`,
            cpf_cnpj: findCol(row, COL_MAP.cpf_cnpj) || null,
            celular: findCol(row, COL_MAP.celular) || null,
            email: findCol(row, COL_MAP.email) || null,
            endereco: findCol(row, COL_MAP.endereco) || null,
            cidade: findCol(row, COL_MAP.cidade) || null,
            estado: findCol(row, COL_MAP.estado) || null,
          });
        });

        // Inserir em batches de 50
        for (let i = 0; i < records.length; i += 50) {
          const batch = records.slice(i, i + 50);
          const { data, error } = await supabase
            .from('clientes')
            .upsert(batch, { onConflict: 'cod_cliente', ignoreDuplicates: false })
            .select();
          if (error) {
            errorList.push(`Batch ${Math.floor(i / 50) + 1}: ${error.message}`);
          } else {
            count += (data?.length || batch.length);
          }
        }

      } else if (type === 'inadimplencia') {
        const records = [];
        const clientCods = new Set();
        const clientNames = {};
        rows.forEach((row, i) => {
          const cod = findCol(row, COL_MAP.cod_cliente);
          if (!cod) { errorList.push(`Linha ${i + 2}: cod_cliente vazio — ignorada`); return; }
          clientCods.add(cod);
          const nome = findCol(row, COL_MAP.razao_social);
          if (nome) clientNames[cod] = nome;
          const valorStr = findCol(row, COL_MAP.valor_devido);
          const dateKey = Object.keys(row).find(k => COL_MAP.data_vencimento.includes(k.toLowerCase().trim()));
          const dateFmt = parseDate(dateKey ? row[dateKey] : '');
          records.push({
            cod_cliente: cod,
            razao_social: nome || null,
            cpf_cnpj: findCol(row, COL_MAP.cpf_cnpj) || null,
            valor_devido_cents: parseValor(valorStr),
            data_vencimento: dateFmt,
          });
        });

        // Buscar nomes de clientes existentes para registros sem nome
        if (records.some(r => !r.razao_social)) {
          const codsSemNome = [...new Set(records.filter(r => !r.razao_social).map(r => r.cod_cliente))];
          for (let i = 0; i < codsSemNome.length; i += 50) {
            const batch = codsSemNome.slice(i, i + 50);
            const { data: clis } = await supabase.from('clientes').select('cod_cliente, razao_social').in('cod_cliente', batch);
            (clis || []).forEach(c => { if (c.razao_social) clientNames[c.cod_cliente] = c.razao_social; });
          }
          records.forEach(r => { if (!r.razao_social && clientNames[r.cod_cliente]) r.razao_social = clientNames[r.cod_cliente]; });
        }

        // Auto-criar clientes que não existem (FK obrigatória)
        if (clientCods.size > 0) {
          const autoClients = [...clientCods].map(cod => ({
            cod_cliente: cod,
            razao_social: `Cliente ${cod}`,
          }));
          for (let i = 0; i < autoClients.length; i += 50) {
            const batch = autoClients.slice(i, i + 50);
            const { error: cliErr } = await supabase
              .from('clientes')
              .upsert(batch, { onConflict: 'cod_cliente', ignoreDuplicates: true });
            if (cliErr) errorList.push(`Auto-clientes batch ${Math.floor(i / 50) + 1}: ${cliErr.message}`);
          }
        }

        // Smart Sync — merge inteligente (não duplica, preenche vazios)
        syncInfo = await smartSyncInadimplencia(records, errorList);
        count = syncInfo.inserted + syncInfo.updated;

      } else if (type === 'vendas') {
        const records = [];
        const clientCods = new Set();
        const clientNames = {};
        rows.forEach((row, i) => {
          const cod = findCol(row, COL_MAP.cod_cliente);
          if (!cod) { errorList.push(`Linha ${i + 2}: cod_cliente vazio — ignorada`); return; }
          clientCods.add(cod);
          const nome = findCol(row, COL_MAP.razao_social);
          if (nome) clientNames[cod] = nome;
          const placa = findCol(row, COL_MAP.placa).toUpperCase().replace(/[^A-Z0-9]/g, '');
          const chassi = findCol(row, COL_MAP.chassi).toUpperCase().replace(/[^A-Z0-9]/g, '');
          // Vendas sem placa e sem chassi são registros inválidos — ignorar
          if (!placa && !chassi) { errorList.push(`Linha ${i + 2}: sem placa e sem chassi — ignorada`); return; }
          const dateKey = Object.keys(row).find(k => COL_MAP.data_venda.includes(k.toLowerCase().trim()));
          const dateFmt = parseDate(dateKey ? row[dateKey] : '');
          const valorStr = findCol(row, COL_MAP.valor_venda);
          records.push({
            cod_cliente: cod,
            razao_social: nome || null,
            data_venda: dateFmt,
            placa: placa || null,
            chassi: chassi || null,
            marca_modelo: findCol(row, COL_MAP.marca_modelo) || null,
            valor_venda_cents: parseValor(valorStr),
          });
        });

        // Buscar nomes de clientes existentes para registros sem nome
        if (records.some(r => !r.razao_social)) {
          const codsSemNome = [...new Set(records.filter(r => !r.razao_social).map(r => r.cod_cliente))];
          for (let i = 0; i < codsSemNome.length; i += 50) {
            const batch = codsSemNome.slice(i, i + 50);
            const { data: clis } = await supabase.from('clientes').select('cod_cliente, razao_social').in('cod_cliente', batch);
            (clis || []).forEach(c => { if (c.razao_social) clientNames[c.cod_cliente] = c.razao_social; });
          }
          records.forEach(r => { if (!r.razao_social && clientNames[r.cod_cliente]) r.razao_social = clientNames[r.cod_cliente]; });
        }

        // Auto-criar clientes que não existem (FK obrigatória)
        if (clientCods.size > 0) {
          const autoClients = [...clientCods].map(cod => ({
            cod_cliente: cod,
            razao_social: `Cliente ${cod}`,
          }));
          for (let i = 0; i < autoClients.length; i += 50) {
            const batch = autoClients.slice(i, i + 50);
            const { error: cliErr } = await supabase
              .from('clientes')
              .upsert(batch, { onConflict: 'cod_cliente', ignoreDuplicates: true });
            if (cliErr) errorList.push(`Auto-clientes batch ${Math.floor(i / 50) + 1}: ${cliErr.message}`);
          }
        }

        // Smart Sync — merge inteligente (não duplica, preenche vazios)
        syncInfo = await smartSyncVendas(records, errorList);
        count = syncInfo.inserted + syncInfo.updated;
      }

      // Pós-sync: Preencher razao_social faltante via tabela clientes
      if (type === 'vendas' || type === 'inadimplencia') {
        await fillMissingRazaoSocial(errorList);
      }

      // Log de importação
      const { error: logErr } = await supabase.from('import_logs').insert({
        protocolo, tipo: type, usuario: user?.email, setor,
        qtd_registros: count, status: errorList.length > 0 ? 'parcial' : 'concluido',
        detalhes: `${count} de ${rows.length} registros | ${errorList.length} erros`,
      });
      if (logErr) errorList.push(`Log: ${logErr.message}`);

      // Audit
      await supabase.from('audit_logs').insert({
        acao: 'IMPORTACAO', setor,
        detalhes: `Import ${type}: ${count} registros | Protocolo: ${protocolo.slice(0, 8)}`,
        user_id: user?.id, user_email: user?.email,
      });

      setErrors(errorList);
      if (count > 0) {
        const detail = syncInfo.updated > 0
          ? `✅ ${syncInfo.inserted} novos + ${syncInfo.updated} atualizados (campos preenchidos) | Protocolo: ${protocolo.slice(0, 8)}`
          : `✅ ${count} registros importados! Protocolo: ${protocolo.slice(0, 8)}`;
        setResult({ success: true, message: detail });
      } else {
        setResult({ success: false, message: `❌ Nenhum registro importado. ${errorList.length} erros encontrados.` });
      }
      setPreview(null);
      refetchLogs();
    } catch (err) {
      setResult({ success: false, message: 'Erro fatal: ' + err.message });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-text">Importar Dados</h1>
        <p className="text-text-muted text-sm mt-1">Upload de planilhas .xlsx / .xls</p>
      </div>

      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />

      {/* Botões de importação */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {IMPORT_TYPES.map(t => (
          <button key={t.key} onClick={() => handleFileSelect(t.key)} disabled={importing}
            className="glass-card p-5 flex items-center gap-4 hover:border-primary/30 transition-all cursor-pointer disabled:opacity-50">
            <div className={`p-3 rounded-xl ${t.bg}`}><t.icon className={`w-6 h-6 ${t.color}`} /></div>
            <div className="text-left">
              <p className="text-sm font-semibold text-text">{t.label}</p>
              <p className="text-xs text-text-muted">.xlsx / .xls / .csv</p>
            </div>
          </button>
        ))}
      </div>

      {/* Resultado */}
      {result && (
        <div className={`glass-card p-4 border ${result.success ? 'border-success/30' : 'border-danger/30'}`}>
          <div className="flex items-center gap-2">
            {result.success ? <Check className="w-5 h-5 text-success shrink-0" /> : <X className="w-5 h-5 text-danger shrink-0" />}
            <p className={`text-sm font-medium ${result.success ? 'text-success' : 'text-danger'}`}>{result.message}</p>
          </div>
        </div>
      )}

      {/* Erros detalhados */}
      {errors.length > 0 && (
        <div className="glass-card p-4 border border-warning/30 max-h-48 overflow-y-auto">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-warning shrink-0" />
            <p className="text-sm font-medium text-warning">{errors.length} avisos/erros</p>
          </div>
          <div className="space-y-1">
            {errors.slice(0, 20).map((e, i) => (
              <p key={i} className="text-xs text-text-muted">• {e}</p>
            ))}
            {errors.length > 20 && <p className="text-xs text-text-muted">... e mais {errors.length - 20} erros</p>}
          </div>
        </div>
      )}

      {/* Preview da planilha */}
      {preview && (
        <div className="glass-card p-4 md:p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-text">{preview.fileName}</h2>
              <span className="text-xs text-text-muted">({preview.data.length} linhas)</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setPreview(null); setErrors([]); }} className="px-3 py-1.5 text-xs text-text-muted hover:text-text bg-surface-2 rounded-lg cursor-pointer">
                Cancelar
              </button>
              <button onClick={processImport} disabled={importing}
                className="px-4 py-1.5 text-xs bg-primary hover:bg-primary-hover text-white rounded-lg cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
                {importing ? <><Loader2 className="w-3 h-3 animate-spin" /> Importando...</> : <><Upload className="w-3 h-3" /> Confirmar Importação</>}
              </button>
            </div>
          </div>

          {/* Colunas detectadas */}
          <div className="mb-3 p-3 bg-surface-2/50 rounded-lg">
            <p className="text-xs text-text-muted mb-1">Colunas detectadas:</p>
            <div className="flex flex-wrap gap-1">
              {preview.columns.map(col => (
                <span key={col} className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full">{col}</span>
              ))}
            </div>
          </div>

          {/* Tabela preview */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border">
                {preview.columns.map(col => (
                  <th key={col} className="text-left py-2 px-3 text-text-muted font-medium whitespace-nowrap">{col}</th>
                ))}
              </tr></thead>
              <tbody>
                {preview.data.slice(0, 10).map((row, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {preview.columns.map((col, j) => (
                      <td key={j} className="py-2 px-3 text-text whitespace-nowrap max-w-[200px] truncate">{String(row[col] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.data.length > 10 && <p className="text-xs text-text-muted text-center py-2">... e mais {preview.data.length - 10} linhas</p>}
          </div>
        </div>
      )}

      {/* Histórico de Importações */}
      <div className="glass-card p-4 md:p-5">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-text">Histórico de Importações</h2>
        </div>
        <div className="space-y-2">
          {logs.map(log => (
            <div key={log.id} className="flex flex-col md:flex-row md:items-center justify-between py-3 border-b border-border last:border-0 gap-2">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="w-4 h-4 text-text-muted shrink-0" />
                <div>
                  <p className="text-sm text-text font-medium">
                    {log.tipo} — {log.qtd_registros} registros
                    <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${log.status === 'concluido' ? 'badge-liberado' : 'badge-atencao'}`}>
                      {log.status}
                    </span>
                  </p>
                  <p className="text-xs text-text-muted">Protocolo: {log.protocolo?.slice(0, 8)}... | {log.usuario}</p>
                  {log.detalhes && <p className="text-xs text-text-muted">{log.detalhes}</p>}
                </div>
              </div>
              <span className="text-xs text-text-muted shrink-0">{formatDateTime(log.created_at)}</span>
            </div>
          ))}
          {logs.length === 0 && <p className="text-sm text-text-muted text-center py-4">Nenhuma importação realizada</p>}
        </div>
      </div>
    </div>
  );
}
