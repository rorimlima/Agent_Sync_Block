import { supabase } from './supabase';

/**
 * Smart Sync Engine — Preenche campos vazios sem sobrescrever dados existentes.
 * Compara registros da planilha com o banco e atualiza apenas campos NULL/vazios.
 */

// Merge: novo valor só entra se o existente é vazio/null
function mergeField(existing, incoming) {
  if (incoming === null || incoming === undefined || incoming === '') return existing;
  if (existing === null || existing === undefined || existing === '') return incoming;
  return existing; // preserva o existente
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
 * Smart upsert para vendas — usa cod_cliente + placa como chave composta.
 * Se existe, preenche campos vazios. Se não existe, insere.
 */
export async function smartSyncVendas(records, errorList) {
  const FIELDS = ['razao_social', 'data_venda', 'placa', 'chassi', 'marca_modelo', 'valor_venda_cents'];
  let inserted = 0, updated = 0;

  // Buscar todos registros existentes por cod_cliente
  const codigos = [...new Set(records.map(r => r.cod_cliente))];
  const existingMap = {};

  for (let i = 0; i < codigos.length; i += 50) {
    const batch = codigos.slice(i, i + 50);
    const { data } = await supabase.from('vendas')
      .select('id, cod_cliente, placa, chassi, razao_social, data_venda, marca_modelo, valor_venda_cents')
      .in('cod_cliente', batch);
    (data || []).forEach(r => {
      const key = `${r.cod_cliente}|${(r.placa || '').toUpperCase()}`;
      if (!existingMap[key]) existingMap[key] = [];
      existingMap[key].push(r);
    });
  }

  const toInsert = [];
  const toUpdate = [];

  for (const rec of records) {
    const key = `${rec.cod_cliente}|${(rec.placa || '').toUpperCase()}`;
    const matches = existingMap[key];

    if (matches && matches.length > 0) {
      // Atualizar o primeiro match com campos faltantes
      const existing = matches[0];
      const { merged, changed } = mergeRecord(existing, rec, FIELDS);
      if (changed) {
        toUpdate.push({ id: existing.id, ...merged });
      }
    } else {
      toInsert.push(rec);
    }
  }

  // Batch insert
  for (let i = 0; i < toInsert.length; i += 50) {
    const batch = toInsert.slice(i, i + 50);
    const { data, error } = await supabase.from('vendas').insert(batch).select();
    if (error) errorList.push(`Insert batch ${Math.floor(i/50)+1}: ${error.message}`);
    else inserted += (data?.length || batch.length);
  }

  // Batch update
  for (const upd of toUpdate) {
    const { id, ...fields } = upd;
    const { error } = await supabase.from('vendas').update(fields).eq('id', id);
    if (error) errorList.push(`Update ${id}: ${error.message}`);
    else updated++;
  }

  return { inserted, updated };
}

/**
 * Smart upsert para inadimplência — usa cod_cliente + valor + data como chave.
 */
export async function smartSyncInadimplencia(records, errorList) {
  const FIELDS = ['razao_social', 'cpf_cnpj', 'valor_devido_cents', 'data_vencimento'];
  let inserted = 0, updated = 0;

  const codigos = [...new Set(records.map(r => r.cod_cliente))];
  const existingMap = {};

  for (let i = 0; i < codigos.length; i += 50) {
    const batch = codigos.slice(i, i + 50);
    const { data } = await supabase.from('inadimplencia')
      .select('id, cod_cliente, cpf_cnpj, razao_social, valor_devido_cents, data_vencimento')
      .in('cod_cliente', batch);
    (data || []).forEach(r => {
      const key = `${r.cod_cliente}|${r.valor_devido_cents}|${r.data_vencimento || ''}`;
      existingMap[key] = r;
    });
  }

  const toInsert = [];
  const toUpdate = [];

  for (const rec of records) {
    const key = `${rec.cod_cliente}|${rec.valor_devido_cents}|${rec.data_vencimento || ''}`;
    const existing = existingMap[key];

    if (existing) {
      const { merged, changed } = mergeRecord(existing, rec, FIELDS);
      if (changed) toUpdate.push({ id: existing.id, ...merged });
    } else {
      toInsert.push(rec);
    }
  }

  for (let i = 0; i < toInsert.length; i += 50) {
    const batch = toInsert.slice(i, i + 50);
    const { data, error } = await supabase.from('inadimplencia').insert(batch).select();
    if (error) errorList.push(`Insert batch ${Math.floor(i/50)+1}: ${error.message}`);
    else inserted += (data?.length || batch.length);
  }

  for (const upd of toUpdate) {
    const { id, ...fields } = upd;
    const { error } = await supabase.from('inadimplencia').update(fields).eq('id', id);
    if (error) errorList.push(`Update ${id}: ${error.message}`);
    else updated++;
  }

  return { inserted, updated };
}

/**
 * Pós-sync: Preenche razao_social em vendas/inadimplência usando tabela clientes
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
