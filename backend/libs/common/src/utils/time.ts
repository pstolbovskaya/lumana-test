export function parseTimeInput(value: unknown): Date | null | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value) : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^\d{10,16}$/.test(trimmed)) return new Date(Number(trimmed));
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : new Date(ms);
}
