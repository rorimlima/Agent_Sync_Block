/**
 * MutationQueue — Fila de mutações Offline-First com Exponential Backoff
 * 
 * ARQUITETURA:
 * 1. UI chama mutate() → grava no IndexedDB local + enfileira para envio
 * 2. processQueue() roda em background (setTimeout, não bloqueia UI)
 * 3. Se falhar, aplica backoff exponencial (2s, 4s, 8s... até 5min)
 * 4. Quando conexão retorna (online event), re-processa automaticamente
 * 
 * REGRA: Este módulo é um SINGLETON. Nunca instancie mais de uma vez.
 */

import { supabase } from '../supabase';
import {
  putRecord,
  softDelete as localSoftDelete,
  enqueueMutation,
  getPendingMutations,
  removeMutation,
  updateMutation,
  countPendingMutations,
  getById,
} from './SyncDatabase';

// ─── Singleton State ────────────────────────────────────────────────────────────

let _isSyncing = false;
let _processTimer = null;
const _subscribers = new Set();

// Status que a UI pode ler: 'idle' | 'syncing' | 'error' | 'offline'
let _currentStatus = 'idle';
let _pendingCount = 0;

function notifyAll() {
  const state = { status: _currentStatus, pendingCount: _pendingCount };
  _subscribers.forEach(cb => {
    try { cb(state); } catch {}
  });
}

// ─── API Pública ────────────────────────────────────────────────────────────────

/**
 * Inscreve um listener para mudanças de status do Sync Engine.
 * Retorna uma função unsubscribe.
 * 
 * Uso na UI: 
 *   useEffect(() => subscribeStatus(({ status, pendingCount }) => { ... }), [])
 */
export function subscribeStatus(callback) {
  _subscribers.add(callback);
  // Envia status atual imediatamente
  callback({ status: _currentStatus, pendingCount: _pendingCount });
  return () => _subscribers.delete(callback);
}

/**
 * Mutação Optimistic — O ponto de entrada PRINCIPAL para toda escrita do app.
 * 
 * @param {string} table - Nome da tabela Supabase
 * @param {'INSERT'|'UPDATE'|'DELETE'} operation - Tipo da operação
 * @param {Object} record - Dados do registro (deve conter 'id' para UPDATE/DELETE)
 * @param {Object} [options] - Opções extras
 * @param {Object} [options.supabasePayload] - Payload customizado para o Supabase (quando difere do record local)
 * @param {Array}  [options.sideEffects] - Array de operações adicionais [{table, operation, record, supabasePayload}]
 * 
 * @returns {Promise<Object>} O registro local atualizado
 */
export async function mutate(table, operation, record, options = {}) {
  const now = new Date().toISOString();
  let localRecord;

  if (operation === 'DELETE') {
    // Soft delete local
    const existing = await getById(table, record.id);
    if (existing) {
      localRecord = { ...existing, is_deleted: true, updated_at: now };
      await putRecord(table, localRecord);
    }
  } else if (operation === 'INSERT') {
    // Garante ID e timestamps
    localRecord = {
      ...record,
      id: record.id || crypto.randomUUID(),
      created_at: record.created_at || now,
      updated_at: now,
      is_deleted: false,
    };
    await putRecord(table, localRecord);
  } else {
    // UPDATE — merge com o existente
    const existing = await getById(table, record.id);
    localRecord = {
      ...(existing || {}),
      ...record,
      updated_at: now,
    };
    await putRecord(table, localRecord);
  }

  // Enfileira a mutação para envio ao servidor
  const supabasePayload = options.supabasePayload || record;
  await enqueueMutation({
    table,
    operation: operation === 'DELETE' ? 'UPDATE' : operation, // Soft delete → UPDATE no Supabase
    payload: operation === 'DELETE'
      ? { id: record.id, is_deleted: true, updated_at: now }
      : { ...supabasePayload, id: localRecord.id, updated_at: now },
  });

  // Enfileira side effects (ex: atualizar vendas quando bloqueia veículo)
  if (options.sideEffects) {
    for (const effect of options.sideEffects) {
      const effectNow = new Date().toISOString();
      // Aplica side effect localmente
      if (effect.record?.id) {
        const existingEffect = await getById(effect.table, effect.record.id);
        if (existingEffect) {
          await putRecord(effect.table, { ...existingEffect, ...effect.record, updated_at: effectNow });
        }
      }
      // Enfileira para o servidor
      await enqueueMutation({
        table: effect.table,
        operation: effect.operation || 'UPDATE',
        payload: { ...( effect.supabasePayload || effect.record ), updated_at: effectNow },
      });
    }
  }

  // Atualiza contagem e dispara processamento em background
  _pendingCount = await countPendingMutations();
  notifyAll();
  scheduleProcess(100); // Processa em 100ms (não bloqueia a UI)

  return localRecord;
}

// ─── Processamento de Fila ──────────────────────────────────────────────────────

function scheduleProcess(delayMs = 1000) {
  if (_processTimer) clearTimeout(_processTimer);
  _processTimer = setTimeout(() => processQueue(), delayMs);
}

async function processQueue() {
  if (_isSyncing) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    _currentStatus = 'offline';
    notifyAll();
    return;
  }

  _isSyncing = true;
  _currentStatus = 'syncing';
  notifyAll();

  try {
    const pending = await getPendingMutations();
    
    if (pending.length === 0) {
      _currentStatus = 'idle';
      _pendingCount = 0;
      notifyAll();
      return;
    }

    for (const job of pending) {
      try {
        await executeServerMutation(job);
        await removeMutation(job.queue_id);
        _pendingCount = Math.max(0, _pendingCount - 1);
        notifyAll();
      } catch (error) {
        console.error(`[SyncEngine] Mutation failed:`, error.message);

        // Exponential backoff: 2s, 4s, 8s, 16s... max 5min
        const backoffDelay = Math.min(2000 * Math.pow(2, job.retry_count), 300000);
        
        await updateMutation(job.queue_id, {
          retry_count: job.retry_count + 1,
          next_retry_at: Date.now() + backoffDelay,
          last_error: error.message,
        });

        // Se estamos offline, para imediatamente
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          _currentStatus = 'offline';
          notifyAll();
          break;
        }
      }
    }
  } catch (err) {
    console.error('[SyncEngine] Queue processing error:', err);
    _currentStatus = 'error';
    notifyAll();
  } finally {
    _isSyncing = false;
    
    // Re-agendar se ainda há pendências
    const remaining = await countPendingMutations();
    _pendingCount = remaining;
    if (remaining > 0 && navigator.onLine) {
      _currentStatus = 'idle'; // Não mostra "syncing" entre tentativas
      scheduleProcess(5000);
    } else if (remaining === 0) {
      _currentStatus = 'idle';
    }
    notifyAll();
  }
}

/**
 * Executa uma mutação individual contra o Supabase
 */
async function executeServerMutation(job) {
  const { table, operation, payload } = job;
  
  if (operation === 'INSERT') {
    // Usa upsert para evitar erro de duplicate key (idempotência)
    const { error } = await supabase.from(table).upsert(payload, { onConflict: 'id' });
    if (error) throw error;
  } else if (operation === 'UPDATE') {
    const { id, ...fields } = payload;
    if (!id) throw new Error('UPDATE sem ID');
    const { error } = await supabase.from(table).update(fields).eq('id', id);
    if (error) throw error;
  }
}

// ─── Recuperação de Conexão ─────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  // Quando volta a ficar online, tenta processar a fila
  window.addEventListener('online', () => {
    console.log('[SyncEngine] Conexão restaurada — processando fila...');
    _currentStatus = 'idle';
    scheduleProcess(500);
  });

  // Quando a tab fica visível novamente, tenta processar
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      scheduleProcess(1000);
    }
  });
}

/**
 * Força o processamento imediato da fila (ex: ao clicar "Tentar novamente")
 */
export function forceProcess() {
  scheduleProcess(0);
}

/**
 * Retorna o status atual sem se inscrever
 */
export function getStatus() {
  return { status: _currentStatus, pendingCount: _pendingCount };
}
