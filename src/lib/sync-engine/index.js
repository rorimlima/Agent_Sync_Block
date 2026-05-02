/**
 * Sync Engine — Barrel Export
 * 
 * Ponto de entrada único para todo o sistema de sincronização.
 * Importar: import { mutate, subscribeTable, initSync } from '@/lib/sync-engine'
 */

// Database (IndexedDB)
export {
  getAll,
  getById,
  putRecord,
  clearTable,
  resetDatabase,
  countPendingMutations,
  KNOWN_TABLES,
} from './SyncDatabase';

// Mutation Queue (Optimistic UI + Background Sync)
export {
  mutate,
  subscribeStatus,
  forceProcess,
  getStatus,
} from './MutationQueue';

// Delta Sync + Realtime
export {
  subscribeTable,
  syncTable,
  initSync,
  forceDeltaSync,
  subscribeRealtime,
  unsubscribeRealtime,
  unsubscribeAllRealtime,
  destroySync,
} from './DeltaSync';
