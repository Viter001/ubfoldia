import { packager } from '@electron/packager';
import { resolve, join } from 'node:path';
import { mkdir, cp, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const root = resolve('.'),
  out = join(root, 'release'),
  temp = join(root, '.agent/runs/mvp/package-temp');
await mkdir(temp, { recursive: true });
process.env.TEMP = temp;
process.env.TMP = temp;
const paths = await packager({
  dir: root,
  name: 'Ubfoldia',
  platform: 'win32',
  arch: 'x64',
  out,
  overwrite: true,
  tmpdir: false,
  asar: false,
  prune: true,
  electronVersion: '45.1.0',
  electronZipDir: undefined,
  ignore: (path) =>
    /^\/node_modules\/\.cache(?:\/|$)/.test(path) ||
    (Boolean(path) &&
      !/^\/(dist(?:-electron)?|examples|node_modules)(?:\/|$)/.test(path) &&
      !/^\/(package\.json|README\.md)$/.test(path)),
});
for (const path of paths) {
  await cp(join(root, 'examples'), join(path, '示例工程'), { recursive: true });
  await cp(join(root, 'README.md'), join(path, '使用说明.md'));
  await cp(join(root, 'docs/agent-tools.md'), join(path, 'Agent接入说明.md'));
  await writeFile(
    join(path, '打开示例.cmd'),
    '@echo off\r\nchcp 65001 >nul\r\nstart "" "%~dp0Ubfoldia.exe" "--project=%~dp0示例工程\\林间来信"\r\n',
  );
  console.log(path);
  // ZIP carries application bytes, not the build workspace's Windows integrity labels.
  // Extract into a normal application directory; do not change workspace ACLs.
  const archive = join(out, 'ubfoldia-0.1.0-win32-x64.zip');
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$ErrorActionPreference='Stop'; Compress-Archive -LiteralPath $env:STUDIO_ARCHIVE_SOURCE -DestinationPath $env:STUDIO_ARCHIVE_DESTINATION -Force",
    ],
    {
      env: { ...process.env, STUDIO_ARCHIVE_SOURCE: path, STUDIO_ARCHIVE_DESTINATION: archive },
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  console.log(`Portable archive: ${archive}`);
}
