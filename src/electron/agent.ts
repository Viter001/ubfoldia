import { isAbsolute, relative } from 'node:path';
import { realpath } from 'node:fs/promises';
import type { Command, Envelope } from '../core/project';
import type { ImportResult, State } from '../shared/studio';
import type { ProjectSession } from './session';

export const AGENT_TOOLS = [
  'project_get',
  'assets_import',
  'pages_add',
  'pages_connect',
  'layers_set_visibility',
  'project_save',
] as const;

export type AgentTool = (typeof AGENT_TOOLS)[number];

export type AgentAssets = {
  importMany(paths: string[]): Promise<ImportResult[]>;
};

/**
 * Agent operations reuse the one CommandService owned by ProjectSession.
 * Receipts keyed by projectId + requestId keep retries idempotent; they are
 * cleared whenever the session switches projects.
 */
export class AgentService {
  private readonly receipts = new Map<string, { signature: string; result: unknown }>();

  constructor(
    private readonly deps: {
      session: ProjectSession;
      assets: AgentAssets;
      publish: () => Promise<State>;
    },
  ) {}

  reset() {
    this.receipts.clear();
  }

  async call(name: string, args: Record<string, any>): Promise<unknown> {
    const session = this.deps.session;
    const service = session.active();
    if (name === 'project_get') {
      return {
        ...(await session.state()),
        tools: [...AGENT_TOOLS],
      };
    }
    const envelope: Envelope = {
      projectId: args.projectId,
      requestId: args.requestId,
      expectedRevision: args.expectedRevision,
    };
    if (envelope.projectId !== service.project.id) throw Error('PROJECT_MISMATCH');
    if (
      typeof envelope.requestId !== 'string' ||
      !envelope.requestId ||
      envelope.requestId.length > 128
    )
      throw Error('INVALID_REQUEST_ID');
    const key = service.project.id + ':' + envelope.requestId,
      signature = JSON.stringify({ name, args }),
      receipt = this.receipts.get(key);
    if (receipt) {
      if (receipt.signature !== signature) throw Error('REQUEST_REUSED');
      return receipt.result;
    }
    if (envelope.expectedRevision !== service.project.revision) throw Error('REVISION_CONFLICT');
    let result: unknown;
    if (name === 'assets_import') {
      if (!Array.isArray(args.paths) || args.paths.length > 50) throw Error('INVALID_PATHS');
      for (const path of args.paths) {
        const actual = await realpath(path);
        if (
          !session.approvedRoots.some((base) => {
            const rel = relative(base, actual);
            return !rel.startsWith('..') && !isAbsolute(rel);
          })
        )
          throw Error('SOURCE_NOT_APPROVED：请在工具中授权素材文件夹');
      }
      result = {
        results: await this.deps.assets.importMany(args.paths),
        revision: service.project.revision,
      };
    } else if (name === 'project_save') {
      await session.save();
      result = { revision: service.project.revision, saved: true };
    } else {
      let command: Command;
      if (name === 'pages_add')
        command = { type: 'page.add', name: args.name, assetId: args.assetId };
      else if (name === 'pages_connect')
        command = {
          type: 'exit.add',
          pageId: args.pageId,
          label: args.label ?? '继续',
          target: args.target,
        };
      else if (name === 'layers_set_visibility')
        command = {
          type: 'layer.patch',
          pageId: args.pageId,
          layerId: args.layerId,
          patch: { visible: args.visible },
        };
      else throw Error('UNKNOWN_TOOL');
      result = service.execute(command, envelope);
    }
    this.receipts.set(key, { signature, result });
    await this.deps.publish();
    return result;
  }
}
