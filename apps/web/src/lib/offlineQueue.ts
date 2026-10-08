/**
 * OFFLINE QUEUE — orders, bills and payments taken without a connection, sent
 * when it is back. Platform-free: the app gives it AsyncStorage and Supabase,
 * the portal gives it localStorage and Supabase.
 *
 * MIRRORED FILE: identical copy at menutha-app-deploy/apps/web/src/lib/offlineQueue.ts.
 *
 * THE RULES, which the tests (packages/shared-tests/offlineQueue.test.ts) hold:
 *   1. Never lose an operation. Every change to the queue is saved before it
 *      is acted on; a crash mid-sync resumes where it stopped.
 *   2. Never do anything twice. Every operation carries its own request id
 *      (idempotency key) for its whole life. A response lost on the way back
 *      is answered, on retry, by the server's memory of the first one.
 *   3. The server decides. Totals, tax and invoice numbers come back from it.
 *      An offline bill has only a local reference until then.
 *   4. Nothing is guessed. A refusal (dish unavailable, table paid elsewhere,
 *      a total that came out different) stops that operation and everything
 *      that depends on it, and waits for a person to choose.
 * Operations are sent in the order they were taken; a refused one holds back
 * only the operations that depend on it (its bill, that bill's payment).
 */

export type OpKind = 'order' | 'bill' | 'settle';
export type OpStatus = 'pending' | 'done' | 'conflict' | 'discarded';

/** A value inside a payload that stands for the server id of an earlier op. */
export type Ref = { $ref: string };
export const ref = (localId: string): Ref => ({ $ref: localId });

export interface QueuedOp {
  /** Local id of the thing this creates ("o:…", "b:…", "s:…"). */
  localId: string;
  kind: OpKind;
  /** The request id sent to the server; never changes once queued. */
  key: string;
  /** Function arguments; may contain Refs. */
  args: Record<string, unknown>;
  status: OpStatus;
  createdAt: string;
  attempts: number;
  /** What the server returned (done), or why it refused (conflict). */
  result?: any;
  error?: { message: string; code?: string };
  /** For a settle: the total the payment was taken against, in paise. */
  expectTotalP?: number;
  /** Shown to staff: "Table 4 · 2 items". */
  label: string;
  /** What the screen needs to show it (dish names, prices, table) — kept on
   *  the phone, never sent. */
  meta?: any;
}

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/** The server call. Throws { message, code? } on failure. A network failure
 *  has no Postgres/PostgREST code; a refusal has one. */
export type Call = (fn: string, args: Record<string, unknown>) => Promise<any>;

export const FN: Record<OpKind, string> = {
  order: 'place_order_once',
  bill: 'create_table_bill_once',
  settle: 'settle_bill',
};

/** A refusal from the server (keep it, ask a person) rather than "could not
 *  reach it" (try again later). */
export function isRefusal(e: any): boolean {
  const code = String(e?.code ?? '');
  if (/^[0-9A-Z]{5}$/.test(code) || code.startsWith('PGRST')) return true;
  const status = Number(e?.status ?? 0);
  return status >= 400 && status < 500;
}

const STORE = 'menutha.offline.queue.v1';
const SEQ = 'menutha.offline.seq.v1';

export interface QueueState { device: string; ops: QueuedOp[] }

export interface SyncReport { sent: number; conflicts: number; pending: number; reachable: boolean }

export class OfflineQueue {
  private state: QueueState | null = null;
  private running: Promise<SyncReport> | null = null;
  private listeners = new Set<(s: QueueState) => void>();

  private kv: KV;
  private call: Call;
  private newId: () => string;
  constructor(kv: KV, call: Call, newId: () => string) { this.kv = kv; this.call = call; this.newId = newId; }

  async load(): Promise<QueueState> {
    if (this.state) return this.state;
    let s: QueueState | null = null;
    try { s = JSON.parse((await this.kv.get(STORE)) ?? 'null'); } catch { s = null; }
    if (!s || !Array.isArray(s.ops)) s = { device: this.newId().replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'DEV1', ops: [] };
    this.state = s;
    return s;
  }
  private async save() {
    await this.kv.set(STORE, JSON.stringify(this.state));
    for (const l of this.listeners) l(this.state!);
  }
  subscribe(fn: (s: QueueState) => void): () => void {
    this.listeners.add(fn);
    if (this.state) fn(this.state);
    return () => { this.listeners.delete(fn); };
  }

  /** The next offline reference for a bill: OFF-<device>-<0001>. */
  async nextRef(): Promise<string> {
    const s = await this.load();
    const n = Number((await this.kv.get(SEQ)) ?? '0') + 1;
    await this.kv.set(SEQ, String(n));
    return `OFF-${s.device}-${String(n).padStart(4, '0')}`;
  }

  async enqueue(op: Omit<QueuedOp, 'status' | 'createdAt' | 'attempts' | 'key'> & { key?: string }): Promise<QueuedOp> {
    const s = await this.load();
    const full: QueuedOp = { ...op, key: op.key ?? `${op.kind}-${this.newId()}`, status: 'pending', createdAt: new Date().toISOString(), attempts: 0 };
    s.ops.push(full);
    await this.save();           // rule 1: saved before anything else happens
    return full;
  }

  /** The server id an earlier op produced, if it has been sent. */
  serverId(localId: string): string | undefined {
    const op = this.state?.ops.find((o) => o.localId === localId);
    return op?.status === 'done' ? (op.result?.id as string | undefined) : undefined;
  }

  private resolve(v: unknown): { value: unknown; missing: string | null } {
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      for (const x of v) { const r = this.resolve(x); if (r.missing) return r; out.push(r.value); }
      return { value: out, missing: null };
    }
    if (v && typeof v === 'object' && '$ref' in (v as any)) {
      const id = this.serverId(String((v as Ref).$ref));
      return id ? { value: id, missing: null } : { value: null, missing: String((v as Ref).$ref) };
    }
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) { const r = this.resolve(x); if (r.missing) return r; out[k] = r.value; }
      return { value: out, missing: null };
    }
    return { value: v, missing: null };
  }

  /** Send everything that can be sent, in order. One run at a time. */
  sync(): Promise<SyncReport> {
    if (!this.running) this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }

  private async run(): Promise<SyncReport> {
    const s = await this.load();
    let sent = 0; let reachable = true;
    const blocked = new Set<string>();     // local ids that failed or wait on a failure
    for (const op of s.ops) {
      if (op.status === 'done' || op.status === 'discarded') continue;
      if (op.status === 'conflict') { blocked.add(op.localId); continue; }
      const r = this.resolve(op.args);
      if (r.missing) {
        // waiting on an earlier op that is in conflict (or not sent yet)
        blocked.add(op.localId);
        continue;
      }
      if (op.kind === 'settle' && op.expectTotalP != null) {
        const bill = s.ops.find((o) => o.kind === 'bill' && o.status === 'done' && o.result?.id === (r.value as any).p_bill_id);
        const serverP = bill ? Math.round(Number(bill.result?.total ?? 0) * 100) : null;
        if (serverP != null && serverP !== op.expectTotalP) {
          op.status = 'conflict';
          op.error = { message: `The bill came to ${(serverP / 100).toFixed(2)} on the server; ${(op.expectTotalP / 100).toFixed(2)} was taken offline.`, code: 'AMOUNT' };
          op.result = { serverTotalP: serverP };
          await this.save();
          blocked.add(op.localId);
          continue;
        }
      }
      op.attempts += 1;
      try {
        const args = { ...(r.value as Record<string, unknown>), ...(op.kind === 'settle' ? { p_idem: op.key } : { p_key: op.key }) };
        const res = await this.call(FN[op.kind], args);
        op.status = 'done'; op.result = res; op.error = undefined;
        await this.save();
        sent += 1;
      } catch (e: any) {
        if (isRefusal(e)) {
          op.status = 'conflict';
          op.error = { message: String(e?.message ?? 'Refused by the server'), code: String(e?.code ?? '') };
          await this.save();
          blocked.add(op.localId);
          continue;
        }
        // could not reach the server: stop, keep everything, try again later
        await this.save();
        reachable = false;
        break;
      }
    }
    return {
      sent,
      conflicts: s.ops.filter((o) => o.status === 'conflict').length,
      pending: s.ops.filter((o) => o.status === 'pending').length,
      reachable,
    };
  }

  /** A person chose: drop this op (and everything that depended on it). */
  async discard(localId: string): Promise<void> {
    const s = await this.load();
    const drop = new Set([localId]);
    for (const o of s.ops) {
      if (drop.has(o.localId)) { o.status = 'discarded'; continue; }
      if (o.status !== 'done' && JSON.stringify(o.args).match(/"\$ref":"([^"]+)"/g)?.some((m) => drop.has(m.slice(8, -1)))) {
        o.status = 'discarded'; drop.add(o.localId);
      }
    }
    await this.save();
  }

  /** A person chose: send it again, changed. A changed op is a NEW request,
   *  so it gets a new request id; an unchanged retry keeps the old one. */
  async retry(localId: string, change?: { args?: Record<string, unknown>; expectTotalP?: number; meta?: any }): Promise<void> {
    const s = await this.load();
    const op = s.ops.find((o) => o.localId === localId);
    if (!op || op.status === 'done') return;
    if (change?.args) { op.args = change.args; op.key = `${op.kind}-${this.newId()}`; }
    if (change && 'expectTotalP' in change) op.expectTotalP = change.expectTotalP;
    if (change?.meta !== undefined) op.meta = change.meta;
    op.status = 'pending'; op.error = undefined;
    await this.save();
  }

  /** Done ops older than a day are forgotten (the server remembers them). */
  async prune(now = Date.now()): Promise<void> {
    const s = await this.load();
    const keep = s.ops.filter((o) => !(o.status === 'done' || o.status === 'discarded')
      || now - Date.parse(o.createdAt) < 24 * 3600_000
      || s.ops.some((x) => x.status !== 'done' && x.status !== 'discarded' && JSON.stringify(x.args).includes(`"${o.localId}"`)));
    if (keep.length !== s.ops.length) { s.ops = keep; await this.save(); }
  }

  /** Pending and refused ops. Call after load(). */
  open(): QueuedOp[] { return (this.state?.ops ?? []).filter((o) => o.status === 'pending' || o.status === 'conflict'); }
}
