import { query } from '../../config/database.js';

/**
 * Resolve an alias to its canonical name from the location_aliases table.
 */
export async function resolveAlias(alias: string): Promise<string | null> {
  if (!alias) return null;
  
  const res = await query(
    'SELECT canonical_name FROM location_aliases WHERE alias = $1 LIMIT 1',
    [alias.toLowerCase().trim()]
  );
  
  if (res.rowCount && res.rowCount > 0) {
    return res.rows[0].canonical_name;
  }
  
  return null;
}
