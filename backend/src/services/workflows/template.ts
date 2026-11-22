/** Resolves "a.b.0.c" / "a.b[0].c" paths against an object. */
export function getPath(obj: any, path: string): any {
  if (!path) return undefined;
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

const isEmpty = (v: any) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function evalExpr(expr: string, ctx: any): any {
  // "path ?? fallback" — fallback may be another path or literal text
  const [left, ...rest] = expr.split('??');
  const value = getPath(ctx, left.trim());
  if (!isEmpty(value) || !rest.length) return value;
  const fb = rest.join('??').trim();
  const fbValue = /^[\w.[\]]+$/.test(fb) ? getPath(ctx, fb) : undefined;
  return isEmpty(fbValue) ? fb : fbValue;
}

const toText = (v: any): string => {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x !== 'object')) return v.join(', ');
  return JSON.stringify(v);
};

/**
 * Recursively replaces {{expr}} placeholders.
 * A string that is exactly "{{expr}}" keeps the raw value (arrays/objects stay structured).
 */
export function resolveTemplates(value: any, ctx: any): any {
  if (typeof value === 'string') {
    const whole = value.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
    if (whole) return evalExpr(whole[1], ctx);
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr) => toText(evalExpr(expr, ctx)));
  }
  if (Array.isArray(value)) return value.map((v) => resolveTemplates(v, ctx));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveTemplates(v, ctx)]));
  return value;
}

export function evaluateCondition(cond: { path: string; operator: string; value?: any } | undefined, ctx: any): boolean {
  if (!cond || !cond.path) return true;
  const v = getPath(ctx, cond.path);
  switch (cond.operator) {
    case 'exists':
      return !isEmpty(v);
    case 'not_exists':
      return isEmpty(v);
    case 'gt':
      return Number(Array.isArray(v) ? v.length : v) > Number(cond.value);
    case 'lt':
      return Number(Array.isArray(v) ? v.length : v) < Number(cond.value);
    case 'eq':
      return String(v) === String(cond.value);
    case 'neq':
      return String(v) !== String(cond.value);
    case 'contains':
      return Array.isArray(v) ? v.includes(cond.value) : String(v ?? '').toLowerCase().includes(String(cond.value).toLowerCase());
    default:
      return true;
  }
}
