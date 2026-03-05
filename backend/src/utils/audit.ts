import { query } from '../database/db';

export interface AuditLogEntry {
  userId?: string;
  action: string;
  resource?: string;
  ipAddress?: string;
  userAgent?: string;
  details?: any;
  status?: 'success' | 'failure';
  errorMessage?: string;
}

/**
 * Log audit event for compliance
 */
export const logAudit = async (entry: AuditLogEntry): Promise<void> => {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, resource, ip_address, user_agent, details, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,

      [
        entry.userId || null,
        entry.action,
        entry.resource || null,
        entry.ipAddress || null,
        entry.userAgent || null,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.status || 'success'
      ]
    );
  } catch (error) {
    console.error('Audit log error:', error);
    // Don't throw - audit failures shouldn't break app
  }
};

/**
 * Get audit logs for user
 */
export const getUserAuditLogs = async (
  userId: string,
  limit: number = 100
): Promise<any[]> => {
  const result = await query(
    `SELECT action, resource, ip_address, details, created_at
     FROM audit_logs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows;
};
