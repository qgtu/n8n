/**
 * URL-friendly slugification: remove accents, special chars, space to dash.
 * Extracted from n8n nodes for production extraction.
 */
export function slugify(text: string): string {
  if (!text) return '';
  
  return text
    .normalize('NFD') // Decompose combined characters
    .replace(/[\u0300-\u036f]/g, '') // remove accent marks
    .replace(/đ/g, 'd').replace(/Đ/g, 'd')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
