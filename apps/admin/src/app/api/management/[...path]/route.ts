import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cashish/core/db';
import { validGodToken } from '@/lib/god-token';
import { findAdminById } from '@/lib/admin-auth';
import { listTenants, getTenant, listPlans } from '@/queries/tenants';
import { listSubscriptions } from '@/queries/subscriptions';
import { withAudit, listAudit } from '@/lib/audit';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
async function handle(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  if (!validGodToken(req.headers.get('authorization'))) return json({ error: 'Unauthorized' }, 401);
  try {
    const admin = process.env.SAAS_ADMIN_ID ? await findAdminById(process.env.SAAS_ADMIN_ID) : null;
    if (!admin || admin.disabledAt) return json({ error: 'Management administrator unavailable' }, 403);
    const { path } = await context.params;
    if (req.method === 'GET') {
      if (path.join('/') === 'tenants') return json({ items: await listTenants() });
      if (path.join('/') === 'plans') return json({ items: await listPlans() });
      if (path.join('/') === 'subscriptions') return json({ items: await listSubscriptions() });
      if (path.join('/') === 'audit') return json({ items: await listAudit() });
      if (path.length === 2 && path[0] === 'tenants') {
        const item = await getTenant(path[1]);
        if (!item) return json({ error: 'Tenant not found' }, 404);
        const { tokens: _tokens, ...safe } = item;
        return json({ item: safe });
      }
    }
    if (req.method === 'PATCH' && path.length === 3 && path[0] === 'tenants' && path[2] === 'status') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      if (!body || Object.keys(body).some(k => k !== 'status') || !['active', 'suspended'].includes(body.status)) return json({ error: 'status must be active or suspended' }, 400);
      const tenantId = path[1];
      const item = await withAudit<{ id: string; beforeStatus: string; status: string }>(admin.id, result => ({ action: 'management.tenant.status', subjectType: 'subscription', subjectId: result.id, tenantId, before: { status: result.beforeStatus }, after: { status: body.status } }), async trx => {
        const [existing] = await trx.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, tenantId)).for('update');
        if (!existing) throw new Error('Subscription not found');
        await trx.update(schema.subscriptions).set({ status: body.status, updatedAt: new Date().toISOString() }).where(eq(schema.subscriptions.id, existing.id));
        return { id: existing.id, beforeStatus: existing.status, status: body.status };
      });
      return json({ item });
    }
    return json({ error: 'Not found' }, 404);
  } catch { return json({ error: 'Management request failed' }, 503); }
}
export { handle as GET, handle as PATCH };
