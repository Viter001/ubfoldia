import { copyFile, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative } from 'node:path';
import type { Asset } from '../core/project';
import type { ImportResult } from '../shared/studio';
import type { ProjectSession } from './session';

export type MediaDecoder = {
  decodeImage(bytes: Buffer, mime: string): Promise<{ width: number; height: number }>;
  decodeAudio(bytes: Buffer, mime: string): Promise<{ duration: number }>;
};

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

/**
 * Copies user-selected media into the project, validates signatures through the
 * decoder window, and records each successful import as an asset command.
 */
export class AssetService {
  constructor(private readonly deps: { session: ProjectSession; decoder: MediaDecoder }) {}

  async importFile(source: string): Promise<Asset> {
    const root = this.deps.session.projectRoot;
    const sourceReal = await realpath(source),
      info = await stat(sourceReal);
    if (!info.isFile() || info.size > 50 * 1024 * 1024)
      throw Error('文件过大或不是普通文件（上限 50 MB）');
    const ext = extname(sourceReal).toLowerCase();
    const mime = MEDIA_TYPES[ext];
    if (!mime) throw Error('不支持此格式，请导入 PNG/JPEG/WebP 或 MP3/WAV/M4A');
    const bytes = await readFile(sourceReal);
    let meta: { width?: number; height?: number; duration?: number } = {};
    if (mime.startsWith('image')) {
      const signature =
        ext === '.png'
          ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : ext === '.webp'
            ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
            : bytes[0] === 255 && bytes[1] === 216;
      if (
        !signature ||
        bytes.includes(Buffer.from('acTL')) ||
        (ext === '.webp' && bytes.includes(Buffer.from('ANIM')))
      )
        throw Error('图片格式不匹配或是动画图片');
      meta = await this.deps.decoder.decodeImage(bytes, mime);
    } else {
      const signature =
        ext === '.wav'
          ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE'
          : ext === '.m4a'
            ? bytes.toString('ascii', 4, 8) === 'ftyp'
            : bytes.toString('ascii', 0, 3) === 'ID3' ||
              (bytes[0] === 255 && (bytes[1] & 224) === 224);
      if (!signature) throw Error('音频格式与扩展名不匹配');
      meta = await this.deps.decoder.decodeAudio(bytes, mime);
    }
    const asset: Asset = {
      id: crypto.randomUUID(),
      name: basename(sourceReal),
      kind: mime.startsWith('image') ? 'image' : 'audio',
      path: '',
      mime,
      ...meta,
    };
    asset.path = `assets/${asset.id}${ext}`;
    await mkdir(join(root, 'assets'), { recursive: true });
    const assetsReal = await realpath(join(root, 'assets')),
      rootReal = await realpath(root),
      assetRel = relative(rootReal, assetsReal);
    if (assetRel.startsWith('..') || isAbsolute(assetRel)) throw Error('ASSET_OUTSIDE_PROJECT');
    await copyFile(sourceReal, join(root, asset.path));
    return asset;
  }

  async importMany(paths: string[]): Promise<ImportResult[]> {
    const results: ImportResult[] = [];
    for (const path of paths) {
      try {
        const asset = await this.importFile(path);
        this.deps.session.active().execute({ type: 'asset.add', asset });
        results.push({ path, assetId: asset.id, ok: true });
      } catch (error) {
        results.push({ path, ok: false, error: String(error) });
      }
    }
    return results;
  }
}
