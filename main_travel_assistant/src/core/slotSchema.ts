/**
 * Slot Schema — Per-intent slot definitions for generic multi-turn filling.
 *
 * Each intent declares required slots with:
 *   - name: ClassifyResult field ('entity', 'entity_origin', etc.)
 *   - prompt: Vietnamese clarify message to ask the user
 *   - validate: returns true if the value is present and valid
 */

import type { ClassifyResult, IntentName } from '../types';

export interface SlotDef {
  name: string;         // ClassifyResult field key
  prompt: string;       // Vietnamese clarify prompt
  validate: (value: any) => boolean;
}

interface IntentSlotSchema {
  slots: SlotDef[];
  /** If true, at least ONE slot being filled is enough (OR logic vs AND logic) */
  anyOneRequired?: boolean;
}

const isValidStr = (v: any): boolean => typeof v === 'string' && v.trim().length >= 2;
const isPositiveInt = (v: any): boolean => typeof v === 'number' && v > 0;

const SLOT_SCHEMAS: Partial<Record<IntentName, IntentSlotSchema>> = {
  GET_PLACE_INFO: {
    slots: [
      { name: 'entity', prompt: 'Bạn muốn tìm hiểu về địa điểm nào ạ?', validate: isValidStr },
    ],
  },
  GET_OPENING_HOURS: {
    slots: [
      { name: 'entity', prompt: 'Bạn muốn hỏi giờ mở cửa ở đâu ạ?', validate: isValidStr },
    ],
  },
  GET_TICKET_PRICE: {
    slots: [
      { name: 'entity', prompt: 'Bạn muốn hỏi giá vé ở địa điểm nào ạ?', validate: isValidStr },
    ],
  },
  GET_WEATHER: {
    slots: [
      { name: 'entity', prompt: 'Bạn muốn xem thời tiết ở đâu ạ?', validate: isValidStr },
    ],
  },
  SEARCH_NEARBY: {
    slots: [
      { name: 'entity', prompt: 'Bạn đang ở khu vực nào ạ?', validate: isValidStr },
    ],
  },
  GET_DIRECTIONS: {
    slots: [
      { name: 'entity_origin', prompt: 'Bạn muốn đi từ đâu ạ?', validate: isValidStr },
      { name: 'entity_destination', prompt: 'Bạn muốn đi đến đâu ạ?', validate: isValidStr },
    ],
  },
  SEARCH_TOUR: {
    slots: [
      { name: 'entity', prompt: 'Bạn muốn tìm tour ở khu vực nào ạ?', validate: isValidStr },
      { name: 'duration_days', prompt: 'Bạn muốn đi tour mấy ngày ạ?', validate: isPositiveInt },
    ],
    anyOneRequired: true,
  },
  DISCOVER_LOCATION: {
    slots: [
      { name: 'entity', prompt: 'Bạn muốn khám phá địa điểm ở đâu ạ? (ví dụ: Đà Nẵng, Hội An)', validate: isValidStr },
    ],
  },
};

/**
 * Get the first missing (unfilled) slot for a given intent.
 * Returns null if all required slots are filled.
 *
 * For SEARCH_TOUR (anyOneRequired): returns null if at least one slot is valid.
 */
export function getMissingSlot(intent: IntentName, ctx: ClassifyResult): SlotDef | null {
  const schema = SLOT_SCHEMAS[intent];
  if (!schema) return null;

  const missing: SlotDef[] = [];
  for (const slot of schema.slots) {
    const value = (ctx as any)[slot.name];
    if (!slot.validate(value)) {
      missing.push(slot);
    }
  }

  if (missing.length === 0) return null;

  // OR logic: at least one is filled → good enough
  if (schema.anyOneRequired && missing.length < schema.slots.length) {
    return null;
  }

  // Return the first missing slot
  return missing[0];
}

/**
 * Extract filled slot values from a ClassifyResult into a plain object.
 */
export function extractFilledSlots(ctx: ClassifyResult): Record<string, any> {
  const filled: Record<string, any> = {};
  if (ctx.entity && ctx.entity.length >= 2) filled.entity = ctx.entity;
  if (ctx.entity_origin && ctx.entity_origin.length >= 2) filled.entity_origin = ctx.entity_origin;
  if (ctx.entity_destination && ctx.entity_destination.length >= 2) filled.entity_destination = ctx.entity_destination;
  if (ctx.duration_days && ctx.duration_days > 0) filled.duration_days = ctx.duration_days;
  if (ctx._nearbyCategory) filled._nearbyCategory = ctx._nearbyCategory;
  if (ctx._routeMode) filled._routeMode = ctx._routeMode;
  return filled;
}
