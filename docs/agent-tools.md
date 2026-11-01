# 外部 Agent 工具说明

本工具不内置 AI。外部支持 MCP 的宿主通过 Node.js 启动 bridge，再连接当前桌面应用；作品编辑与人工操作共用命令服务和撤销栈。

## 本地 MCP 配置

先启动应用并打开工程；导入素材前，在流程右侧点击“授权素材文件夹”。仅明确授权的目录及其子目录可供 Agent 导入。

配置示意（路径替换成实际绝对路径；配置项名称按宿主适配）：

```json
{
  "mcpServers": {
    "picture_book_studio": {
      "command": "node",
      "args": ["E:/code saving/PICTURE-BOOK-STUDIO/dist-electron/bridge.mjs"]
    }
  }
}
```

源码构建后 bridge 在 `dist-electron/bridge.mjs`；打包版在 `resources/app/dist-electron/bridge.mjs`。打包版 bridge 旁的 `resources/app/node_modules` 必须保留。bridge 需要宿主可用的 Node.js 24。

默认 endpoint 是 `%APPDATA%/ubfoldia/agent-endpoint.json`。自定义应用数据目录时，应用和 bridge 共用 `STUDIO_USER_DATA`，或在 bridge 环境中用 `STUDIO_ENDPOINT` 指定 endpoint 文件绝对路径。此文件含本地连接令牌，不要复制进工程、提示词或 Git。

Codex 可用单次 `-c` 覆盖临时配置，不必修改全局配置；实际验收使用此方法。参见 [官方 CLI 文档](https://developers.openai.com/codex/cli/reference/)。可执行验证见 `scripts/agent-host.mjs`，仅针对脚本创建的一次性工程。

<a id="dsh"></a>
## DSH 接入准备

2026-10-29 用户询问安装方式，已提供以下步骤。**目前仅为配置说明，未代用户修改 DSH 配置，也未取得 DSH 真实调用成功证据。** 不把此前 Codex 或 SDK 测试算作 DSH 验收。

1. 从普通应用目录启动未视之视，新建空白测试工程并保持窗口开启；如需导入素材，先在界面授权素材文件夹。
2. 在正在使用的 DSH 配置范围新增一个本地 stdio MCP 服务；下列为单个原生插件条目，不覆盖现有完整配置。不需要另填模型 API Key。

```yaml
- id: mcp-ubfoldia
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: ubfoldia
    transport: stdio
    command: 'E:/code_env/nodejs/node.exe'
    args:
      - 'E:/Test/Ubfoldia/resources/app/dist-electron/bridge.mjs'
```

这是本机已核对的 Node 与打包 bridge 路径；其他机器应替换路径。配置格式依据此前核对的 [DSH 官方 MCP client 说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md)，具体 UI 入口依宿主而定。

3. 保存并重新加载配置，确认出现 `mcp__ubfoldia__project_get` 等六工具，再调用 `project_get` 读取当前工程；工具可见与读写成功分别确认。
4. 首次测试仅操作空白测试工程：创建开始、森林、湖畔、结束四页；连接开始→森林/湖畔、森林→开始/结束、湖畔→结束；保存并重新读取核对。要求 Agent 只用 MCP、不直接改 JSON，使用真实 ID、最新 revision 和唯一 requestId。观察界面同步，再手动预览分支与回连。

完成后记录实际成功/失败调用和界面结果，再更新验收状态。现有接口尚未开放完整排版、文字与动画编辑，不能据此要求 Agent 自动完成全部编辑器功能。讨论来源见 D-024（本地讨论记录）。

## 六个工具

| 工具 | 作用 | 业务参数 |
| --- | --- | --- |
| `project_get` | 读取当前工程、素材、页面、出口、revision 与缺失素材 | 无 |
| `assets_import` | 从授权目录逐个导入素材 | `paths`，最多 50 个文件 |
| `pages_add` | 创建页面，可附背景图片图层 | `name`、可选 `assetId` |
| `pages_connect` | 添加具名出口，支持分支及回连 | `pageId`、`target`、`label` |
| `layers_set_visibility` | 显示或隐藏图层 | `pageId`、`layerId`、`visible` |
| `project_save` | 保存工程 | 无额外业务参数 |

所有写工具都需 `projectId`、`requestId`、`expectedRevision`。先 `project_get`，然后使用每次成功写入返回的新 revision。新操作使用新 requestId；同一操作重试复用完全相同的参数及 requestId。遇到 `REVISION_CONFLICT` 重新读取，不覆盖其他人的修改。

回执只对本次打开有效；用户撤销不抹去“请求曾经成功”的历史回执，重试不会重复执行已撤销的操作。重开工程会重置回执和撤销栈，宿主应重新读取并开始新的请求序列。保存时会先提交编辑器焦点字段；因此人工刚提交的输入可能使 Agent 的旧 revision 冲突，这是预期保护。

预览使用启动快照。Agent 修改时会显示“工程已更新，重新预览后生效”，当前阅读不改变。退出再预览才使用新内容。

## 工程规范

`project.json` 的 `schemaVersion=1`，包含稳定 ID、revision、尺寸、页面/图层/出口、素材和音画配置。素材使用 `assets/` 下相对路径；读取工程不执行脚本。未知版本、未知字段或无效引用拒绝编辑，缺失实体文件保留引用并显示占位。

单文件最大 50 MB；当前目标格式是 PNG/JPEG/静态 WebP、MP3/PCM WAV/AAC M4A，不承诺所有编码变体。图片和音频必须通过解码才进入素材列表。替换使用新素材引用，不覆盖或自动删除旧文件，保证撤销与预览快照可用。
