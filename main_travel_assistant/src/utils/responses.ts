import type { InternalResponse } from '../types';

/**
 * Standardized response builders.
 *
 * | Case            | Type       | Message template                            |
 * |-----------------|------------|---------------------------------------------|
 * | DB empty        | not_found  | "Chưa có thông tin về X"                    |
 * | API timeout     | temp_error | "Hệ thống đang bận, thử lại sau"           |
 * | All fail        | error      | "Không thể xử lý lúc này"                  |
 * | Context missing | clarify    | Ask user for missing data                   |
 * | Success         | text       | Formatted result                            |
 */

export function notFound(entityName: string): InternalResponse {
  return {
    type: 'not_found',
    message: `Xin lỗi, mình chưa tìm thấy thông tin về "${entityName}". Bạn thử kiểm tra lại tên nhé.`,
  };
}

export function tempError(context = ''): InternalResponse {
  return {
    type: 'temp_error',
    message: `⚠️ ${context ? context + ' — ' : ''}Hệ thống đang bận. Bạn vui lòng thử lại sau giây lát nhé.`,
  };
}

export function allFailed(): InternalResponse {
  return {
    type: 'error',
    message: '⚠️ Đã xảy ra lỗi. Bạn vui lòng thử lại sau giây lát nhé.',
  };
}

export function clarify(question: string): InternalResponse {
  return { type: 'clarify', message: question };
}

export function success(message: string, data?: any): InternalResponse {
  return { type: 'text', message, data };
}
