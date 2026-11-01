import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { join } from 'node:path';
const endpoint =
  process.env.STUDIO_ENDPOINT ||
  join(
    process.env.STUDIO_USER_DATA || join(process.env.APPDATA || '', 'ubfoldia'),
    'agent-endpoint.json',
  );
const server = new McpServer(
  { name: 'ubfoldia', version: '0.1.0' },
  {
    instructions:
      '先 project_get。修改请求使用 project.id 和 revision。新操作用新 requestId；重试保留同一 requestId 和完全相同参数。版本冲突后重新读取工程。用户撤销不撤回历史请求回执；重开工程后应重新读取并发起新请求。',
  },
);
async function call(name: string, args: unknown) {
  const { pipe, token } = JSON.parse(await readFile(endpoint, 'utf8'));
  return new Promise((resolve, reject) => {
    const socket = connect(pipe);
    socket.setEncoding('utf8');
    let buffer = '';
    socket.setTimeout(120000, () => {
      socket.destroy();
      reject(Error('工具调用超时'));
    });
    socket.on('connect', () =>
      socket.write(JSON.stringify({ id: crypto.randomUUID(), token, name, args }) + '\n'),
    );
    socket.on('error', reject);
    socket.on('data', (chunk) => {
      buffer += chunk;
      const i = buffer.indexOf('\n');
      if (i >= 0) {
        socket.end();
        const response = JSON.parse(buffer.slice(0, i));
        response.error ? reject(Error(response.error)) : resolve(response.result);
      }
    });
  });
}
const envelope = {
  projectId: z.string().describe('project_get 返回的 project.id'),
  requestId: z.string().min(1).max(128).describe('新操作使用新 ID；同一操作重试复用相同 ID 和参数'),
  expectedRevision: z
    .number()
    .int()
    .nonnegative()
    .describe('最近读取或修改返回的 revision；冲突后重新读取'),
};
const definitions = [
  {
    name: 'project_get',
    description:
      '读取当前打开的工程与 revision。先调用此工具，修改时提供返回的 projectId/revision。',
    schema: {},
  },
  {
    name: 'assets_import',
    description: '导入用户已在桌面工具授权文件夹中的素材；逐个返回结果。',
    schema: { ...envelope, paths: z.array(z.string()).max(50) },
  },
  {
    name: 'pages_add',
    description: '新增页面，可使用已经导入的图片素材作为背景图层。',
    schema: { ...envelope, name: z.string(), assetId: z.string().optional() },
  },
  {
    name: 'pages_connect',
    description: '新增具名出口连接目标页，支持分支回连，禁止直接自环。',
    schema: { ...envelope, pageId: z.string(), target: z.string(), label: z.string() },
  },
  {
    name: 'layers_set_visibility',
    description: '设置图层显示状态，与人工编辑共用撤销。',
    schema: { ...envelope, pageId: z.string(), layerId: z.string(), visible: z.boolean() },
  },
  { name: 'project_save', description: '安全保存当前工程。', schema: envelope },
];
for (const d of definitions)
  server.registerTool(
    d.name,
    { description: d.description, inputSchema: d.schema },
    async (args: Record<string, unknown>) => {
      try {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(await call(d.name, args)) }],
        };
      } catch (e) {
        return { isError: true, content: [{ type: 'text' as const, text: String(e) }] };
      }
    },
  );
await server.connect(new StdioServerTransport());
