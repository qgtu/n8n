import type { ClassifyResult, InternalResponse } from '../types';
import { getMissingSlot } from './slotSchema';

/**
 * Per-intent data readiness gate.
 * Returns clarification prompt if required fields are missing.
 * Returns null if context is complete → handler can proceed.
 *
 * Delegates to slotSchema for generic slot validation.
 */
export function validateContext(ctx: ClassifyResult): InternalResponse | null {
  if (ctx.intent === 'UNKNOWN') return null;

  const missing = getMissingSlot(ctx.intent, ctx);
  if (missing) {
    return { type: 'clarify', message: missing.prompt };
  }

  return null;
}
