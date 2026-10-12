import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';
import { makeModel } from '../../test/fake-orm.js';

function controllerWith(db: Record<string, any>) {
  // Only the ORM surface the controller touches is faked; the rest is never
  // reached because PrismaService's client is passed through as-is.
  return new HealthController({ client: { orm: { public: db } } } as any);
}

describe('HealthController', () => {
  it('counts rows in the database instead of loading every row into memory', async () => {
    const customers = makeModel([{}, {}, {}]);
    const campaigns = makeModel([{}]);
    const messages = makeModel([{}, {}]);
    // Guard: the endpoint must not pull whole tables via .all() to count them.
    const allSpy = vi.spyOn(customers, 'all');

    const ctrl = controllerWith({ Customer: customers, Campaign: campaigns, Message: messages });
    const res = await ctrl.check();

    expect(res.status).toBe('ok');
    expect(res.database).toEqual({ connected: true, customers: 3, campaigns: 1, messages: 2 });
    expect(allSpy).not.toHaveBeenCalled();
  });

  it('does not fabricate success when the database is unreachable', async () => {
    const broken = {
      aggregate: async () => {
        throw new Error('connection refused');
      },
    };
    const ctrl = controllerWith({ Customer: broken, Campaign: makeModel([]), Message: makeModel([]) });

    // The probe rejects; the HTTP layer turns that into a non-2xx so the
    // platform sees the service as unhealthy instead of "ok" on a dead DB.
    await expect(ctrl.check()).rejects.toThrow('connection refused');
  });

  it('returns zero counts for an empty database', async () => {
    const ctrl = controllerWith({
      Customer: makeModel([]),
      Campaign: makeModel([]),
      Message: makeModel([]),
    });

    const res = await ctrl.check();
    expect(res.database).toEqual({ connected: true, customers: 0, campaigns: 0, messages: 0 });
  });
});