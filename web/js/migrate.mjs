// Client-side local-to-account migration (Requirement 5). Detects an existing local household,
// offers import, and drives the migrate-import edge function. Non-destructive: the local copy is
// kept until the server confirms success, and the migrated marker makes re-import a no-op (R5.4,
// R5.5, NFR 6). Pure helpers here (detection, signature, marker) are unit-tested; the actual
// edge-function call is injected so tests don't hit the network.
import { STORAGE_KEY } from './store.js';

export const MIGRATED_MARKER_KEY = 'roomsync.migrated.v1';

/** Read + parse the local household, or null if none / unreadable. */
export function readLocal(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || s.version !== 1 || !s.household || !Array.isArray(s.members)) return null;
    return s;
  } catch { return null; }
}

/** Has this local household already been migrated? (R5.4) */
export function alreadyMigrated(storage) {
  try { return !!storage.getItem(MIGRATED_MARKER_KEY); } catch { return false; }
}

/** True when there is importable local data that hasn't been migrated yet (R5.1). */
export function hasImportableLocal(storage) {
  return !alreadyMigrated(storage) && !!readLocal(storage);
}

/**
 * A stable signature of the local source so repeated imports are idempotent (NFR 6). Based on
 * the household id + createdAt, which don't change across retries of the same local data.
 */
export function sourceSignature(local) {
  if (!local || !local.household) return null;
  return `${local.household.id}:${local.household.createdAt || ''}`;
}

/** Record that migration succeeded so we never re-import (R5.4). Keeps the local copy intact. */
export function markMigrated(storage, householdId) {
  try { storage.setItem(MIGRATED_MARKER_KEY, householdId || '1'); } catch { /* storage blocked: ignore */ }
}

/**
 * Run the migration. `invokeImport(payload)` is the injected edge-function caller returning
 * { ok, householdId } or { ok:false, error }. On success we mark migrated and DO NOT delete the
 * local copy (safety net, R5.4). On failure the local data is untouched and we report clearly
 * (R5.5). `meLocalId` is which local member the signer is (default: currentUser / first).
 */
export async function runMigration(storage, invokeImport, { meLocalId } = {}) {
  const local = readLocal(storage);
  if (!local) return { ok: false, error: 'No local household to import.' };
  if (alreadyMigrated(storage)) return { ok: true, alreadyImported: true };

  const chosen = meLocalId || local.currentUserId || (local.members[0] && local.members[0].id);
  const payload = { local, meLocalId: chosen, sourceSignature: sourceSignature(local) };

  let res;
  try { res = await invokeImport(payload); }
  catch (e) { return { ok: false, error: 'Import failed. Your local data is unchanged — please try again.' }; }

  if (!res || !res.ok) {
    return { ok: false, error: (res && res.error) || 'Import failed. Your local data is unchanged.' };
  }
  markMigrated(storage, res.householdId);  // keep local copy; just stop re-importing
  return { ok: true, householdId: res.householdId, alreadyImported: !!res.alreadyImported };
}
