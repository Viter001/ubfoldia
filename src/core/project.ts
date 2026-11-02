import { z } from 'zod';
const id = z.string().min(1).max(128);
const number = z.number().finite();
const effect = z
  .object({ type: z.enum(['none', 'fade']), duration: number.min(0.1).max(3) })
  .strict();
const layer = z
  .object({
    id,
    name: z.string().max(300),
    type: z.enum(['text', 'image']),
    x: number,
    y: number,
    width: number.positive().max(20000),
    height: number.positive().max(20000),
    visible: z.boolean(),
    text: z.string().max(100000).optional(),
    assetId: id.optional(),
    fontSize: number.min(1).max(500),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    align: z.enum(['left', 'center', 'right']),
    effect,
  })
  .strict();
const track = z
  .object({ assetId: id, volume: number.min(0).max(1) })
  .strict()
  .nullable();
const page = z
  .object({
    id,
    name: z.string().min(1).max(300),
    position: z.object({ x: number, y: number }).strict(),
    layers: z.array(layer).max(1000),
    exits: z
      .array(z.object({ id, label: z.string().max(300), target: id.nullable() }).strict())
      .max(1000),
    music: track,
    voice: track,
    transition: effect,
    background: z.string().regex(/^#[0-9a-f]{6}$/i),
  })
  .strict();
const asset = z
  .object({
    id,
    name: z.string(),
    kind: z.enum(['image', 'audio']),
    path: z.string().regex(/^assets\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|mp3|wav|m4a)$/),
    mime: z.string(),
    width: number.positive().optional(),
    height: number.positive().optional(),
    duration: number.nonnegative().optional(),
  })
  .strict();
export const projectSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    name: z.string().min(1).max(300),
    revision: z.number().int().nonnegative(),
    width: number.int().min(200).max(4096),
    height: number.int().min(200).max(4096),
    startPageId: id.nullable(),
    pages: z.array(page).max(1000),
    assets: z.array(asset).max(10000),
  })
  .strict();
const pagePatchSchema = z
  .object({
    name: z.string().min(1).max(300),
    position: z.object({ x: number, y: number }).strict(),
    music: track,
    voice: track,
    transition: effect,
    background: z.string().regex(/^#[0-9a-f]{6}$/i),
  })
  .partial()
  .strict();
const batchPagePatchSchema = z
  .object({
    transition: effect,
    background: z.string().regex(/^#[0-9a-f]{6}$/i),
  })
  .partial()
  .strict();
const layerPatchSchema = z
  .object({
    name: z.string().max(300),
    x: number,
    y: number,
    width: number.positive().max(20000),
    height: number.positive().max(20000),
    visible: z.boolean(),
    text: z.string().max(100000),
    assetId: id,
    fontSize: number.min(1).max(500),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    align: z.enum(['left', 'center', 'right']),
    effect,
  })
  .partial()
  .strict();
const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('page.add'),
      name: z.string().min(1).max(300),
      assetId: id.optional(),
    })
    .strict(),
  z.object({ type: z.literal('page.delete'), pageId: id }).strict(),
  z.object({ type: z.literal('page.patch'), pageId: id, patch: pagePatchSchema }).strict(),
  z.object({ type: z.literal('start.set'), pageId: id.nullable() }).strict(),
  z
    .object({
      type: z.literal('exit.add'),
      pageId: id,
      label: z.string().max(300),
      target: id.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('exit.patch'),
      pageId: id,
      exitId: id,
      label: z.string().max(300).optional(),
      target: id.nullable().optional(),
    })
    .strict(),
  z.object({ type: z.literal('exit.delete'), pageId: id, exitId: id }).strict(),
  z
    .object({
      type: z.literal('layer.add'),
      pageId: id,
      kind: z.enum(['text', 'image']),
      assetId: id.optional(),
    })
    .strict(),
  z
    .object({ type: z.literal('layer.patch'), pageId: id, layerId: id, patch: layerPatchSchema })
    .strict(),
  z.object({ type: z.literal('layer.delete'), pageId: id, layerId: id }).strict(),
  z.object({ type: z.literal('layer.move'), pageId: id, layerId: id, delta: number }).strict(),
  z
    .object({
      type: z.literal('pages.move'),
      updates: z
        .array(
          z
            .object({
              pageId: id,
              position: z.object({ x: number, y: number }).strict(),
            })
            .strict(),
        )
        .min(1)
        .max(1000),
    })
    .strict(),
  z
    .object({
      type: z.literal('pages.patch'),
      pageIds: z.array(id).min(1).max(1000),
      patch: batchPagePatchSchema,
    })
    .strict(),
  z.object({ type: z.literal('asset.add'), asset }).strict(),
]);
const commandTypes = new Set([
  'page.add',
  'page.delete',
  'page.patch',
  'start.set',
  'exit.add',
  'exit.patch',
  'exit.delete',
  'layer.add',
  'layer.patch',
  'layer.delete',
  'layer.move',
  'pages.move',
  'pages.patch',
  'asset.add',
]);
function parseCommand(input: unknown): Command {
  const type =
    typeof input === 'object' && input !== null ? (input as { type?: unknown }).type : undefined;
  if (typeof type !== 'string' || !commandTypes.has(type)) throw Error('未知命令');
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) throw Error('INVALID_COMMAND');
  return parsed.data as Command;
}
export type Project = z.infer<typeof projectSchema>;
export type Page = Project['pages'][number];
export type Layer = Page['layers'][number];
export type Asset = Project['assets'][number];
export type Envelope = { projectId: string; requestId: string; expectedRevision: number };
export type Command =
  | { type: 'page.add'; name: string; assetId?: string }
  | { type: 'page.delete'; pageId: string }
  | {
      type: 'page.patch';
      pageId: string;
      patch: Partial<
        Pick<Page, 'name' | 'position' | 'music' | 'voice' | 'transition' | 'background'>
      >;
    }
  | { type: 'start.set'; pageId: string | null }
  | { type: 'exit.add'; pageId: string; label: string; target: string | null }
  | { type: 'exit.patch'; pageId: string; exitId: string; label?: string; target?: string | null }
  | { type: 'exit.delete'; pageId: string; exitId: string }
  | { type: 'layer.add'; pageId: string; kind: 'text' | 'image'; assetId?: string }
  | {
      type: 'layer.patch';
      pageId: string;
      layerId: string;
      patch: Partial<Omit<Layer, 'id' | 'type'>>;
    }
  | { type: 'layer.delete'; pageId: string; layerId: string }
  | { type: 'layer.move'; pageId: string; layerId: string; delta: number }
  | {
      type: 'pages.move';
      updates: Array<{ pageId: string; position: { x: number; y: number } }>;
    }
  | {
      type: 'pages.patch';
      pageIds: string[];
      patch: { transition?: Page['transition']; background?: string };
    }
  | { type: 'asset.add'; asset: Asset };
export const uid = () => crypto.randomUUID();
export function createProject(name: string, width: number, height: number): Project {
  return validateProject({
    schemaVersion: 1,
    id: uid(),
    name,
    revision: 0,
    width,
    height,
    startPageId: null,
    pages: [],
    assets: [],
  });
}
export function validateProject(input: unknown): Project {
  const p = projectSchema.parse(input);
  const ids = new Set<string>();
  for (const item of [
    p,
    ...p.pages,
    ...p.assets,
    ...p.pages.flatMap((x) => [...x.layers, ...x.exits]),
  ]) {
    if (ids.has(item.id)) throw Error('DUPLICATE_ID');
    ids.add(item.id);
  }
  const pages = new Set(p.pages.map((x) => x.id)),
    assets = new Map(p.assets.map((x) => [x.id, x]));
  if (p.startPageId && !pages.has(p.startPageId)) throw Error('INVALID_START');
  for (const page of p.pages) {
    for (const e of page.exits)
      if (e.target === page.id || (e.target && !pages.has(e.target))) throw Error('INVALID_TARGET');
    for (const l of page.layers)
      if (l.type === 'image' && (!l.assetId || assets.get(l.assetId)?.kind !== 'image'))
        throw Error('INVALID_IMAGE');
    for (const t of [page.music, page.voice])
      if (t && assets.get(t.assetId)?.kind !== 'audio') throw Error('INVALID_AUDIO');
  }
  return p;
}
function newLayer(p: Project, kind: 'text' | 'image', assetId?: string): Layer {
  const a = p.assets.find((x) => x.id === assetId);
  if (kind === 'image' && a?.kind !== 'image') throw Error('图片素材不存在');
  const ratio =
    kind === 'image'
      ? Math.min(p.width / (a!.width || p.width), p.height / (a!.height || p.height))
      : 1;
  return {
    id: uid(),
    name: kind === 'text' ? '文字' : a!.name,
    type: kind,
    x: kind === 'text' ? 80 : 0,
    y: kind === 'text' ? 80 : 0,
    width: kind === 'text' ? Math.min(640, p.width - 80) : (a!.width || p.width) * ratio,
    height: kind === 'text' ? 120 : (a!.height || p.height) * ratio,
    visible: true,
    ...(kind === 'image' ? { assetId } : { text: '在这里写下你的故事' }),
    fontSize: 40,
    color: '#283b35',
    align: 'left',
    effect: { type: 'none', duration: 0.5 },
  };
}
export class CommandService {
  project: Project;
  private past: Project[] = [];
  private future: Project[] = [];
  private receipts = new Map<
    string,
    { signature: string; result: { id?: string; revision: number } }
  >();
  constructor(project: Project) {
    this.project = validateProject(project);
  }
  snapshot() {
    return structuredClone(this.project);
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  execute(input: Command, envelope?: Envelope): { id?: string; revision: number } {
    const command = parseCommand(input);
    const signature = JSON.stringify(command);
    if (envelope !== undefined) {
      if (!envelope || typeof envelope !== 'object') throw Error('INVALID_ENVELOPE');
      if (envelope.projectId !== this.project.id) throw Error('PROJECT_MISMATCH');
      if (
        typeof envelope.requestId !== 'string' ||
        !envelope.requestId ||
        envelope.requestId.length > 128
      )
        throw Error('INVALID_REQUEST_ID');
      if (!Number.isInteger(envelope.expectedRevision) || envelope.expectedRevision < 0)
        throw Error('INVALID_ENVELOPE');
      const prior = this.receipts.get(envelope.requestId);
      if (prior) {
        if (prior.signature !== signature) throw Error('REQUEST_REUSED');
        return prior.result;
      }
      if (envelope.expectedRevision !== this.project.revision)
        throw Error('REVISION_CONFLICT：请重新读取工程');
    }
    const p = this.snapshot();
    let resultId: string | undefined;
    const getPage = (i: string) => {
      const found = p.pages.find((x) => x.id === i);
      if (!found) throw Error('页面不存在');
      return found;
    };
    switch (command.type) {
      case 'page.add': {
        const n: Page = {
          id: uid(),
          name: command.name,
          position: {
            x: 80 + (p.pages.length % 3) * 350,
            y: 80 + Math.floor(p.pages.length / 3) * 300,
          },
          layers: [],
          exits: [],
          music: null,
          voice: null,
          transition: { type: 'none', duration: 0.5 },
          background: '#faf8f2',
        };
        if (command.assetId) n.layers.push(newLayer(p, 'image', command.assetId));
        p.pages.push(n);
        if (p.pages.length === 1) p.startPageId = n.id;
        resultId = n.id;
        break;
      }
      case 'page.delete':
        getPage(command.pageId);
        p.pages = p.pages.filter((x) => x.id !== command.pageId);
        for (const pg of p.pages) pg.exits = pg.exits.filter((e) => e.target !== command.pageId);
        if (p.startPageId === command.pageId) p.startPageId = null;
        break;
      case 'page.patch':
        Object.assign(getPage(command.pageId), command.patch);
        break;
      case 'start.set':
        if (command.pageId) getPage(command.pageId);
        p.startPageId = command.pageId;
        break;
      case 'exit.add': {
        const pg = getPage(command.pageId);
        const e = { id: uid(), label: command.label, target: command.target };
        pg.exits.push(e);
        resultId = e.id;
        break;
      }
      case 'exit.patch': {
        const e = getPage(command.pageId).exits.find((x) => x.id === command.exitId);
        if (!e) throw Error('出口不存在');
        if (command.label !== undefined) e.label = command.label;
        if (command.target !== undefined) e.target = command.target;
        break;
      }
      case 'exit.delete': {
        const pg = getPage(command.pageId);
        if (!pg.exits.some((e) => e.id === command.exitId)) throw Error('出口不存在');
        pg.exits = pg.exits.filter((e) => e.id !== command.exitId);
        break;
      }
      case 'layer.add': {
        const l = newLayer(p, command.kind, command.assetId);
        getPage(command.pageId).layers.push(l);
        resultId = l.id;
        break;
      }
      case 'layer.patch': {
        const l = getPage(command.pageId).layers.find((x) => x.id === command.layerId);
        if (!l) throw Error('图层不存在');
        Object.assign(l, command.patch);
        break;
      }
      case 'layer.delete': {
        const pg = getPage(command.pageId);
        if (!pg.layers.some((l) => l.id === command.layerId)) throw Error('图层不存在');
        pg.layers = pg.layers.filter((l) => l.id !== command.layerId);
        break;
      }
      case 'layer.move': {
        const pg = getPage(command.pageId),
          i = pg.layers.findIndex((x) => x.id === command.layerId);
        if (i < 0) throw Error('图层不存在');
        const j = Math.max(0, Math.min(pg.layers.length - 1, i + Math.sign(command.delta)));
        const [l] = pg.layers.splice(i, 1);
        pg.layers.splice(j, 0, l);
        break;
      }
      case 'pages.move': {
        const seen = new Set<string>();
        for (const update of command.updates) {
          if (seen.has(update.pageId)) throw Error('DUPLICATE_PAGE');
          seen.add(update.pageId);
          Object.assign(getPage(update.pageId).position, update.position);
        }
        break;
      }
      case 'pages.patch': {
        const seen = new Set<string>();
        for (const pageId of command.pageIds) {
          if (seen.has(pageId)) throw Error('DUPLICATE_PAGE');
          seen.add(pageId);
          Object.assign(getPage(pageId), structuredClone(command.patch));
        }
        break;
      }
      case 'asset.add':
        p.assets.push(command.asset);
        resultId = command.asset.id;
        break;
      default:
        throw Error('未知命令');
    }
    p.revision++;
    const validated = validateProject(p);
    this.past.push(this.snapshot());
    if (this.past.length > 100) this.past.shift();
    this.future = [];
    this.project = validated;
    const result = { id: resultId, revision: p.revision };
    if (envelope) this.receipts.set(envelope.requestId, { signature, result });
    return result;
  }
  undo() {
    if (!this.canUndo) return;
    this.future.push(this.snapshot());
    this.project = { ...this.past.pop()!, revision: this.project.revision + 1 };
  }
  redo() {
    if (!this.canRedo) return;
    this.past.push(this.snapshot());
    this.project = { ...this.future.pop()!, revision: this.project.revision + 1 };
  }
}
export function issues(p: Project): Map<string, string[]> {
  const result = new Map(p.pages.map((pg) => [pg.id, [] as string[]]));
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    p.pages.find((pg) => pg.id === id)?.exits.forEach((e) => e.target && visit(e.target));
  };
  if (p.startPageId) visit(p.startPageId);
  for (const pg of p.pages) {
    if (!seen.has(pg.id)) result.get(pg.id)!.push('从起点不可达');
    if (pg.exits.some((e) => !e.target)) result.get(pg.id)!.push('有未连接出口');
  }
  return result;
}
