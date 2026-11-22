import mongoose from 'mongoose';
import { AuditLogModel, IAuditLog } from '../../models/audit-log.model';
import { compact } from '../../utils/async-handler';
import { logger } from '../../utils/logger';

const SENSITIVE = /token|secret|password|apikey|api_key|authorization|credential/i;

function redact(obj: any, depth = 0): any {
  if (!obj || typeof obj !== 'object' || depth > 4) return obj;
  if (Array.isArray(obj)) return obj.slice(0, 20).map((v) => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, SENSITIVE.test(k) ? '[REDACTED]' : redact(v, depth + 1)]));
}

/** Fire-and-forget audit trail. Never throws and never blocks the request. */
export function audit(entry: Partial<IAuditLog>): void {
  if (mongoose.connection.readyState !== 1) return;
  AuditLogModel.create({ ...entry, details: compact(redact(entry.details), 3000) }).catch((err) => logger.warn('Audit log write failed', { error: err.message }));
}
