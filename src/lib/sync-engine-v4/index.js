/**
 * Sync Engine v4 — Barrel Export
 * 
 * ═══════════════════════════════════════════════════════════════════════
 * PUBLIC API — Import everything from '@/lib/sync-engine-v4'
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * All exports come from SyncBridge (Main Thread side).
 * The Worker files are NEVER imported directly by the application code.
 */

export {
  initSync,
  subscribeTable,
  subscribeStatus,
  subscribeProgress,
  mutate,
  forceDeltaSync,
  forceHardSync,
  getAll,
  forceProcess,
  resetDatabase,
  destroySync,
  terminateWorker,
} from './SyncBridge.js';
