'use client';
import { useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRealtime } from '@/hooks/useRealtime';
import { Upload, Users, AlertTriangle, ShoppingCart, FileSpreadsheet, Check, X, Loader2, Clock } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';

export default function ImportarPage() {
  const { setor, user } = useAuth();
  const { data: logs, refetch: refetchLogs } = useRealtime('import_logs', { orderBy: 'created_at', orderAsc: false });
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [importType, setImportType] = useState('');
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const IMPORT_TYPES = [
    { key: 'clientes', label: 'Importar Clientes', icon: Users, color: 'text-primary', bg: 'bg-primary/10' },
    { key: 'inadimplencia', label: 'Importar Inadimplência', icon: AlertTriangle, color: 'text-danger', bg: 'bg-danger/10' },
    { key: 'vendas', label: 'Importar Vendas', icon: ShoppingCart, color: 'text-success', bg: 'bg-success/10' },
  ];

  const handleFileSelect = (type) => {
    setImportType(type);
    setResult(null);
    fileRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet);
      setPreview({ data, fileName: file.name, type: importType });
    } catch (err) {
      setResult({ success: false, message: 'Erro ao ler arquivo: ' + err.message });
    }
  };

  const processImport = async () => {
    if (!preview) return;
    setImporting(true);
    setResult(null);
    try {
      const { data: rows, type } = preview;
      let count = 0;
      const protocolo = crypto.randomUUID();

      if (type === 'clientes') {
        for (const row of rows) {
          const record = {
            cod_cliente: String(row['cod_cliente'] || row['codigo'] || row['id'] || '').trim(),
            razao_social: String(row['razao_social'] || row['nome'] || row['cliente'] || '').trim(),
            cpf_cnpj: String(row['cpf_cnpj'] || row['cpf'] || row['cnpj'] || '').trim(),
            celular: String(row['celular'] || row['telefone'] || '').trim(),
            email: String(row['email'] || '').trim(),
          };
          if (!record.cod_cliente) continue;
          const { error } = await supabase.from('clientes').upsert(record, { onConflict: 'cod_cliente' });
          if (!error) count++;
        }
      } else if (type === 'inadimplencia') {
        for (const row of rows) {
          const valorStr = String(row['valor_devido'] || row['valor'] || '0');
          const valorNum = parseFloat(valorStr.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
          const record = {
            cod_cliente: String(row['cod_cliente'] || row['codigo'] || '').trim(),
            cpf_cnpj: String(row['cpf_cnpj'] || row['cpf'] || '').trim(),
            valor_devido_cents: Math.round(valorNum * 100),
            data_vencimento: row['data_vencimento'] || row['vencimento'] || null,
          };
          if (!record.cod_cliente) continue;
          const { error } = await supabase.from('inadimplencia').insert(record);
          if (!error) count++;
        }
      } else if (type === 'vendas') {
        for (const row of rows) {
          const valorStr = String(row['valor_venda'] || row['valor'] || '0');
          const valorNum = parseFloat(valorStr.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
          const placa = String(row['placa'] || '').trim().toUpperCase();
          const record = {
            cod_cliente: String(row['cod_cliente'] || row['codigo'] || '').trim(),
            data_venda: row['data_venda'] || row['data'] || null,
            placa,
            marca_modelo: String(row['marca_modelo'] || row['veiculo'] || '').trim(),
            valor_venda_cents: Math.round(valorNum * 100),
          };
          if (!record.cod_cliente) continue;
          const { error } = await supabase.from('vendas').insert(record);
          if (!error) count++;
        }
      }

      await supabase.from('import_logs').insert({
        protocolo, tipo: type, usuario: user.email, setor,
        qtd_registros: count, status: 'concluido',
        detalhes: `Importado ${count} de ${rows.length} linhas`,
      });
      await supabase.from('audit_logs').insert({
        acao: 'IMPORTACAO', setor,
        detalhes: `Import ${type}: ${count} registros | Protocolo: ${protocolo.slice(0, 8)}`,
        user_id: user.id, user_email: user.email,
      });

      setResult({ success: true, message: `✅ ${count} registros importados! Protocolo: ${protocolo.slice(0, 8)}` });
      setPreview(null);
      refetchLogs();
    } catch (err) {
      setResult({ success: false, message: 'Erro: ' + err.message });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-text">Importar Dados</h1>
        <p className="text-text-muted text-sm mt-1">Upload de planilhas .xlsx</p>
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {IMPORT_TYPES.map(t => (
          <button key={t.key} onClick={() => handleFileSelect(t.key)} disabled={importing}
            className="glass-card p-5 flex items-center gap-4 hover:border-primary/30 transition-all cursor-pointer disabled:opacity-50">
            <div className={`p-3 rounded-xl ${t.bg}`}><t.icon className={`w-6 h-6 ${t.color}`} /></div>
            <div className="text-left">
              <p className="text-sm font-semibold text-text">{t.label}</p>
              <p className="text-xs text-text-muted">.xlsx</p>
            </div>
          </button>
        ))}
      </div>
      {result && (
        <div className={`glass-card p-4 border ${result.success ? 'border-success/30' : 'border-danger/30'}`}>
          <div className="flex items-center gap-2">
            {result.success ? <Check className="w-5 h-5 text-success" /> : <X className="w-5 h-5 text-danger" />}
            <p className={`text-sm font-medium ${result.success ? 'text-success' : 'text-danger'}`}>{result.message}</p>
          </div>
        </div>
      )}
      {preview && (
        <div className="glass-card p-4 md:p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-text">Preview: {preview.fileName}</h2>
              <span className="text-xs text-text-muted">({preview.data.length} linhas)</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setPreview(null)} className="px-3 py-1.5 text-xs text-text-muted hover:text-text bg-surface-2 rounded-lg cursor-pointer">Cancelar</button>
              <button onClick={processImport} disabled={importing}
                className="px-4 py-1.5 text-xs bg-primary hover:bg-primary-hover text-white rounded-lg cursor-pointer disabled:opacity-50 flex items-center gap-1">
                {importing ? <><Loader2 className="w-3 h-3 animate-spin" /> Importando...</> : <><Upload className="w-3 h-3" /> Confirmar</>}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border">
                {Object.keys(preview.data[0] || {}).map(col => (
                  <th key={col} className="text-left py-2 px-3 text-text-muted font-medium">{col}</th>
                ))}
              </tr></thead>
              <tbody>
                {preview.data.slice(0, 10).map((row, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {Object.values(row).map((val, j) => (
                      <td key={j} className="py-2 px-3 text-text">{String(val)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.data.length > 10 && <p className="text-xs text-text-muted text-center py-2">... e mais {preview.data.length - 10} linhas</p>}
          </div>
        </div>
      )}
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
                  <p className="text-sm text-text font-medium">{log.tipo} — {log.qtd_registros} registros</p>
                  <p className="text-xs text-text-muted">Protocolo: {log.protocolo?.slice(0, 8)}... | {log.usuario}</p>
                </div>
              </div>
              <span className="text-xs text-text-muted">{formatDateTime(log.created_at)}</span>
            </div>
          ))}
          {logs.length === 0 && <p className="text-sm text-text-muted text-center py-4">Nenhuma importação realizada</p>}
        </div>
      </div>
    </div>
  );
}
