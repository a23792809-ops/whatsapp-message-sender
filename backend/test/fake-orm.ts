/**
 * In-memory stand-in for the Prisma 8 fluent ORM collection
 * (`db.orm.<ns>.<Model>`) used by the campaign engine.
 *
 * It implements exactly the surface the engine relies on — `where` (shorthand
 * object and lambda forms), `orderBy`, `limit`, `offset`, `all`, `first`,
 * `aggregate`, `groupBy(...).aggregate(...)`, `createAll` and
 * `where(...).update(...)` — so unit tests exercise the real query shapes the
 * service builds instead of a stub that silently accepts anything.
 *
 * Rows are mutated in place, exactly as a database would, so a test can hold
 * on to the array it seeded and assert on the result.
 */

export type Row = Record<string, any>;

type Pred = { kind: 'pred'; field: string; op: string; value?: unknown };
/** An OR group, mirroring the `{ kind: 'or', exprs }` shape Prisma 8 returns. */
type PredGroup = { kind: 'or'; preds: Pred[] };
type AnyPred = Pred | PredGroup;
type Order = { kind: 'order'; field: string; dir: 'asc' | 'desc' };
type Agg = { kind: 'agg'; op: 'count' | 'sum' | 'min' | 'max'; field?: string };

type CollState = {
  preds: AnyPred[];
  orders: Order[];
  limit?: number;
  offset?: number;
};

function isPred(value: unknown): value is Pred {
  return !!value && (value as { kind?: string }).kind === 'pred';
}

function isPredGroup(value: unknown): value is PredGroup {
  return !!value && (value as { kind?: string }).kind === 'or';
}

/**
 * Field proxy handed to `where` / `orderBy` lambdas. Mirrors the Prisma 8
 * operator surface (`eq`, `in`, `asc`, …) and records what was asked for so the
 * fake can evaluate it against a row.
 */
function fieldProxy(): Record<string, any> {
  return new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key !== 'string') return undefined;
        const field = key;
        const pred = (op: string, value?: unknown): Pred => ({ kind: 'pred', field, op, value });
        return {
          eq: (v: unknown) => pred('eq', v),
          neq: (v: unknown) => pred('neq', v),
          lt: (v: unknown) => pred('lt', v),
          lte: (v: unknown) => pred('lte', v),
          gt: (v: unknown) => pred('gt', v),
          gte: (v: unknown) => pred('gte', v),
          in: (v: unknown) => pred('in', v),
          like: (v: unknown) => pred('like', v),
          ilike: (v: unknown) => pred('ilike', v),
          isNull: () => pred('isNull'),
          asc: (): Order => ({ kind: 'order', field, dir: 'asc' }),
          desc: (): Order => ({ kind: 'order', field, dir: 'desc' }),
        };
      },
    },
  );
}

function toPreds(value: unknown): AnyPred[] {
  if (Array.isArray(value)) return value.flatMap(toPreds);
  if (isPred(value)) return [value];
  // `or(...)` is one indivisible unit, so it collapses into a single group
  // rather than being flattened into the surrounding AND chain.
  if (isPredGroup(value)) {
    const inner = (value as unknown as { exprs: unknown[] }).exprs ?? [];
    return [{ kind: 'or', preds: inner.flatMap(toPreds) as Pred[] }];
  }
  throw new Error('fake-orm: unsupported where() expression');
}

function toOrders(value: unknown): Order[] {
  if (Array.isArray(value)) return value.flatMap(toOrders);
  if (value && (value as { kind?: string }).kind === 'order') return [value as Order];
  throw new Error('fake-orm: unsupported orderBy() expression');
}

function likeMatch(actual: unknown, pattern: unknown, insensitive: boolean): boolean {
  if (typeof actual !== 'string' || typeof pattern !== 'string') return false;
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  const re = new RegExp(`^${escaped}$`, insensitive ? 'i' : '');
  return re.test(actual);
}

function matches(row: Row, pred: AnyPred): boolean {
  // An OR group matches when any member matches; surrounding predicates are
  // ANDed together by the caller.
  if (isPredGroup(pred)) return pred.preds.some((inner) => matches(row, inner));
  const actual = row[pred.field];
  switch (pred.op) {
    case 'eq':
      return actual === pred.value;
    case 'neq':
      return actual !== pred.value;
    case 'lt':
      return (actual as number) < (pred.value as number);
    case 'lte':
      return (actual as number) <= (pred.value as number);
    case 'gt':
      return (actual as number) > (pred.value as number);
    case 'gte':
      return (actual as number) >= (pred.value as number);
    case 'in':
      return Array.isArray(pred.value) && pred.value.includes(actual);
    case 'like':
      return likeMatch(actual, pred.value, false);
    case 'ilike':
      return likeMatch(actual, pred.value, true);
    case 'isNull':
      return actual === null || actual === undefined;
    default:
      throw new Error(`fake-orm: unsupported operator ${pred.op}`);
  }
}

function aggregateBuilder(): Record<string, any> {
  return {
    count: (): Agg => ({ kind: 'agg', op: 'count' }),
    sum: (field: string): Agg => ({ kind: 'agg', op: 'sum', field }),
    min: (field: string): Agg => ({ kind: 'agg', op: 'min', field }),
    max: (field: string): Agg => ({ kind: 'agg', op: 'max', field }),
  };
}

function computeAggregate(rows: Row[], spec: Record<string, Agg>): Row {
  const out: Row = {};
  for (const [alias, agg] of Object.entries(spec)) {
    switch (agg.op) {
      case 'count':
        out[alias] = rows.length;
        break;
      case 'sum':
        out[alias] = rows.reduce((total, row) => total + Number(row[agg.field as string] ?? 0), 0);
        break;
      case 'min':
        out[alias] = rows.reduce<number | null>(
          (acc, row) => (acc === null || Number(row[agg.field as string]) < acc ? Number(row[agg.field as string]) : acc),
          null,
        );
        break;
      case 'max':
        out[alias] = rows.reduce<number | null>(
          (acc, row) => (acc === null || Number(row[agg.field as string]) > acc ? Number(row[agg.field as string]) : acc),
          null,
        );
        break;
    }
  }
  return out;
}

class FakeGroupedCollection {
  constructor(
    private readonly store: Row[],
    private readonly state: CollState,
    private readonly fields: string[],
  ) {}

  async aggregate(fn: (agg: Record<string, any>) => Record<string, Agg>): Promise<Row[]> {
    const spec = fn(aggregateBuilder());
    const groups = new Map<string, { keys: unknown[]; rows: Row[] }>();
    for (const row of selectRows(this.store, this.state)) {
      const keys = this.fields.map((f) => row[f]);
      const key = JSON.stringify(keys);
      const bucket = groups.get(key);
      if (bucket) bucket.rows.push(row);
      else groups.set(key, { keys, rows: [row] });
    }
    return Array.from(groups.values()).map((bucket) => {
      const base: Row = {};
      this.fields.forEach((f, i) => {
        base[f] = bucket.keys[i];
      });
      return { ...base, ...computeAggregate(bucket.rows, spec) };
    });
  }
}

class FakeCollection {
  private readonly state: CollState;

  constructor(
    private readonly store: Row[],
    state?: CollState,
    private readonly sequence: { next: number } = { next: 0 },
  ) {
    this.state = state ?? { preds: [], orders: [] };
  }

  private next(patch: Partial<CollState>): FakeCollection {
    return new FakeCollection(this.store, { ...this.state, ...patch }, this.sequence);
  }

  where(filter: unknown): FakeCollection {
    if (typeof filter === 'function') {
      const produced = (filter as (model: Record<string, any>) => unknown)(fieldProxy());
      return this.next({ preds: [...this.state.preds, ...toPreds(produced)] });
    }
    const preds = Object.entries(filter as Row).map(
      ([field, value]) => ({ kind: 'pred', field, op: 'eq', value }) as Pred,
    );
    return this.next({ preds: [...this.state.preds, ...preds] });
  }

  orderBy(selection: unknown): FakeCollection {
    const builders = Array.isArray(selection) ? selection : [selection];
    const orders = builders.flatMap((build) => toOrders((build as (m: Record<string, any>) => unknown)(fieldProxy())));
    return this.next({ orders: [...this.state.orders, ...orders] });
  }

  limit(n: number): FakeCollection {
    return this.next({ limit: n });
  }

  offset(n: number): FakeCollection {
    return this.next({ offset: n });
  }

  groupBy(...fields: string[]): FakeGroupedCollection {
    return new FakeGroupedCollection(this.store, this.state, fields);
  }

  async all(): Promise<Row[]> {
    return selectRows(this.store, this.state).map((row) => ({ ...row }));
  }

  async first(): Promise<Row | null> {
    const row = selectRows(this.store, this.state)[0];
    return row ? { ...row } : null;
  }

  async aggregate(fn: (agg: Record<string, any>) => Record<string, Agg>): Promise<Row> {
    return computeAggregate(selectRows(this.store, this.state), fn(aggregateBuilder()));
  }

  async update(values: Row): Promise<Row | null> {
    const matched = selectRows(this.store, this.state);
    for (const row of matched) Object.assign(row, values);
    return matched[0] ? { ...matched[0] } : null;
  }

  async createAll(list: Row[]): Promise<Row[]> {
    const created = list.map((values) => {
      this.sequence.next += 1;
      const row: Row = { id: `gen-${this.sequence.next}`, ...values };
      this.store.push(row);
      return { ...row };
    });
    return created;
  }

  async create(values: Row): Promise<Row> {
    const [row] = await this.createAll([values]);
    return row;
  }

  /**
   * Insert-or-update. Like Prisma 8, the row to match is inferred from the
   * create branch's primary key (`id`, else `key`) rather than from a
   * `where`, which this builder does not receive.
   */
  async upsert(spec: { create: Row; update: Row }): Promise<Row> {
    const identityField = spec.create.id !== undefined ? 'id' : spec.create.key !== undefined ? 'key' : null;
    if (identityField) {
      const matched = this.store.filter((row) => row[identityField] === spec.create[identityField]);
      if (matched.length > 0) {
        Object.assign(matched[0], spec.update);
        return { ...matched[0] };
      }
    }
    return this.create(spec.create);
  }

  /** Delete every row matching the current predicate. */
  async delete(): Promise<Row[]> {
    const matched = selectRows(this.store, this.state);
    for (const row of matched) {
      const at = this.store.indexOf(row);
      if (at >= 0) this.store.splice(at, 1);
    }
    return matched.map((row) => ({ ...row }));
  }
}

function selectRows(store: Row[], state: CollState): Row[] {
  let rows = store.filter((row) => state.preds.every((pred) => matches(row, pred)));

  if (state.orders.length > 0) {
    const decorated = rows.map((row, index) => ({ row, index }));
    decorated.sort((a, b) => {
      for (const order of state.orders) {
        const av = a.row[order.field] as never;
        const bv = b.row[order.field] as never;
        if (av < bv) return order.dir === 'asc' ? -1 : 1;
        if (av > bv) return order.dir === 'asc' ? 1 : -1;
      }
      return a.index - b.index;
    });
    rows = decorated.map((entry) => entry.row);
  }

  const offset = state.offset ?? 0;
  const limited = state.limit === undefined ? rows.slice(offset) : rows.slice(offset, offset + state.limit);
  return limited;
}

export type FakeOrmModel = FakeCollection;

export function makeModel(store: Row[]): FakeCollection {
  return new FakeCollection(store);
}

/** Builds the `orm.public` surface that `PrismaService.client` exposes. */
export function makeOrm(seed: Record<string, Row[]>): { orm: { public: Record<string, FakeCollection> } } {
  const publicModels: Record<string, FakeCollection> = {};
  for (const [name, store] of Object.entries(seed)) {
    publicModels[name] = makeModel(store);
  }
  return { orm: { public: publicModels } };
}
