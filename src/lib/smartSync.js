import { supabase } from './supabase';

/**
 * Smart Sync Engine — Preenche campos vazios sem sobrescrever dados existentes.
 * Compara registros da planilha com o banco e atualiza apenas campos NULL/vazios.
 */

function mergeField(existing, incoming) {
  if (incoming === null || incoming === undefined || incoming === '') return existing;
  if (existing === null || existing === undefined || existing === '') return incoming;
  return existing;
}

function mergeRecord(existing, incoming, fields) {
  const merged = {};
  let changed = false;
  for (const f of fields) {
    merged[f] = mergeField(existing[f], incoming[f]);
    if (merged[f] !== existing[f]) changed = true;
  }
  return { merged, changed };
}

/**
 * Smart upsert para vendas.
 * Match: cod_cliente + placa + valor (quando placa existe) ou cod_cliente + valor (quando placa é null).
 * Cada registro existente só pode ser usado 1 vez (_matched flag).
 */
export async function smartSyncVendas(records, errorList) {
  const FIELDS = ['razao_social', 'data_venda', 'placa', 'chassi', 'marca_modelo', 'valor_venda_cents'];
  let inserted = 0, updated = 0;

  const codigos = [...new Set(records.map(r => r.cod_cliente))];
  const existingByCode = {};

  for (let i = 0; i < codigos.length; i += 50) {
    const batch = codigos.slice(i, i + 50);
    const { data } = await supabase.from('vendas')
      .select('id, cod_cliente, placa, chassi, razao_social, data_venda, marca_modelo, valor_venda_cents')
      .in('cod_cliente', batch);
    (data || []).forEach(r => {
      if (!existingByCode[r.cod_cliente]) existingByCode[r.cod_cliente] = [];
      existingByCode[r.cod_cliente].push({ ...r, _matched: false });
    });
  }

  const toInsert = [];
  const toUpdate = [];

  for (const rec of records) {
    const candidates = existingByCode[rec.cod_cliente] || [];
    let match = null;

    for (const ex of candidates) {
      if (ex._matched) continue;
      // Match por placa OU chassi (pelo menos um identificador deve bater)
      const placaOk = rec.placa && ex.placa && rec.placa.toUpperCase() === ex.placa.toUpperCase();
      const chassiOk = rec.chassi && ex.chassi && rec.chassi.toUpperCase() === ex.chassi.toUpperCase();
      if (placaOk || chassiOk) { match = ex; break; }
    }

    if (match) {
      match._matched = true;
      const { merged, changed } = mergeRecord(match, rec, FIELDS);
      if (changed) toUpdate.push({ id: match.id, ...merged });
    } else {
      toInsert.push(rec);
    }
  }

  for (let i = 0; i < toInsert.length; i += 50) {
    const batch = toInsert.slice(i, i + 50);
    const { data, error } = await supabase.from('vendas').insert(batch).select();
    if (error) errorList.push(`Insert batch ${Math.floor(i/50)+1}: ${error.message}`);
    else inserted += (data?.length || batch.length);
  }

  for (const upd of toUpdate) {
    const { id, ...fields } = upd;
    const { error } = await supabase.from('vendas').update(fields).eq('id', id);
    if (error) errorList.push(`Update ${id}: ${error.message}`);
    else updated++;
  }

  return { inserted, updated };
}

/**
 * Smart upsert para inadimplência.
 * PRIMARY KEY: lancamento (unique index no banco).
 * - Registros COM lancamento: match direto por lancamento (100% preciso, sem duplicatas).
 * - Registros SEM lancamento: fallback por cod_cliente + valor + data_vencimento.
 */
export async function smartSyncInadimplencia(records, errorList) {
  const FIELDS = ['razao_social', 'cpf_cnpj', 'valor_devido_cents', 'data_vencimento', 'lancamento', 'cod_cliente'];
  let inserted = 0, updated = 0;

  // Normalizar: empty string lancamento → null
  records.forEach(r => { if (r.lancamento === '') r.lancamento = null; });

  // Separar registros COM e SEM lancamento
  const withLanc = records.filter(r => r.lancamento);
  const withoutLanc = records.filter(r => !r.lancamento);

  // ===== 1) Registros COM lancamento — upsert direto via chave única =====
  if (withLanc.length > 0) {
    // Buscar existentes por lancamento
    const lancValues = withLanc.map(r => r.lancamento);
    const existingByLanc = {};

    for (let i = 0; i < lancValues.length; i += 200) {
      const batch = lancValues.slice(i, i + 200);
      const { data } = await supabase.from('inadimplencia')
        .select('id, cod_cliente, cpf_cnpj, razao_social, valor_devido_cents, data_vencimento, lancamento')
        .in('lancamento', batch);
      (data || []).forEach(r => { existingByLanc[r.lancamento] = r; });
    }

    const toInsertLanc = [];
    const toUpdateLanc = [];

    for (const rec of withLanc) {
      const existing = existingByLanc[rec.lancamento];
      if (existing) {
        // Já existe — merge apenas campos vazios
        const { merged, changed } = mergeRecord(existing, rec, FIELDS);
        if (changed) toUpdateLanc.push({ id: existing.id, ...merged });
      } else {
        toInsertLanc.push(rec);
      }
    }

    // Insert novos
    for (let i = 0; i < toInsertLanc.length; i += 50) {
      const batch = toInsertLanc.slice(i, i + 50);
      const { data, error } = await supabase.from('inadimplencia').insert(batch).select();
      if (error) errorList.push(`Insert lancamento batch ${Math.floor(i/50)+1}: ${error.message}`);
      else inserted += (data?.length || batch.length);
    }

    // Update existentes
    for (const upd of toUpdateLanc) {
      const { id, ...fields } = upd;
      const { error } = await supabase.from('inadimplencia').update(fields).eq('id', id);
      if (error) errorList.push(`Update ${id}: ${error.message}`);
      else updated++;
    }
  }

  // ===== 2) Registros SEM lancamento — fallback por cod_cliente + valor + data =====
  if (withoutLanc.length > 0) {
    const codigos = [...new Set(withoutLanc.map(r => r.cod_cliente))];
    const existingByCode = {};

    for (let i = 0; i < codigos.length; i += 50) {
      const batch = codigos.slice(i, i + 50);
      const { data } = await supabase.from('inadimplencia')
        .select('id, cod_cliente, cpf_cnpj, razao_social, valor_devido_cents, data_vencimento, lancamento')
        .in('cod_cliente', batch)
        .is('lancamento', null);
      (data || []).forEach(r => {
        if (!existingByCode[r.cod_cliente]) existingByCode[r.cod_cliente] = [];
        existingByCode[r.cod_cliente].push({ ...r, _matched: false });
      });
    }

    const toInsertNoLanc = [];
    const toUpdateNoLanc = [];

    for (const rec of withoutLanc) {
      const candidates = existingByCode[rec.cod_cliente] || [];
      let match = null;

      for (const ex of candidates) {
        if (ex._matched) continue;
        const valorMatch = rec.valor_devido_cents === ex.valor_devido_cents;
        const dateMatch = (rec.data_vencimento || '') === (ex.data_vencimento || '');
        if (valorMatch && dateMatch) { match = ex; break; }
      }

      if (match) {
        match._matched = true;
        const { merged, changed } = mergeRecord(match, rec, FIELDS);
        if (changed) toUpdateNoLanc.push({ id: match.id, ...merged });
      } else {
        toInsertNoLanc.push(rec);
      }
    }

    for (let i = 0; i < toInsertNoLanc.length; i += 50) {
      const batch = toInsertNoLanc.slice(i, i + 50);
      const { data, error } = await supabase.from('inadimplencia').insert(batch).select();
      if (error) errorList.push(`Insert batch ${Math.floor(i/50)+1}: ${error.message}`);
      else inserted += (data?.length || batch.length);
    }

    for (const upd of toUpdateNoLanc) {
      const { id, ...fields } = upd;
      const { error } = await supabase.from('inadimplencia').update(fields).eq('id', id);
      if (error) errorList.push(`Update ${id}: ${error.message}`);
      else updated++;
    }
  }

  return { inserted, updated };
}

/**
 * Pós-sync: Preenche razao_social faltante via tabela clientes
 */
export async function fillMissingRazaoSocial(errorList) {
  const tables = ['vendas', 'inadimplencia'];
  for (const table of tables) {
    try {
      let pg = 0, more = true;
      while (more) {
        const { data: rows } = await supabase.from(table)
          .select('id, cod_cliente')
          .or('razao_social.is.null,razao_social.eq.')
          .range(pg * 200, (pg + 1) * 200 - 1);
        if (!rows || rows.length === 0) { more = false; break; }

        const cods = [...new Set(rows.map(r => r.cod_cliente))];
        const { data: clis } = await supabase.from('clientes')
          .select('cod_cliente, razao_social').in('cod_cliente', cods);
        const nameMap = {};
        (clis || []).forEach(c => { if (c.razao_social) nameMap[c.cod_cliente] = c.razao_social; });

        for (const row of rows) {
          if (nameMap[row.cod_cliente]) {
            await supabase.from(table).update({ razao_social: nameMap[row.cod_cliente] }).eq('id', row.id);
          }
        }
        more = rows.length === 200;
        pg++;
      }
    } catch (err) {
      errorList.push(`fillRazaoSocial ${table}: ${err.message}`);
    }
  }
}
