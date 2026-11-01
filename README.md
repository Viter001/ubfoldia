# 绘境 · 交互叙事工作台

Electron + React + 自有作品模型的本地创作工具。当前为 **0.1.0 开发预览版**：可以制作、预览、保存互动绘本，外部 Agent 通过 MCP 协助编辑。生产界面已接入终端优先的深色主题、Windows 原生按钮覆盖式标题栏、按用途划分的六类功能区、固定的预览分体按钮和任务内转场／动画设置、按前进／循环／后退着色的流程连线，以及同风格退出确认；重复的品牌／全局操作行已移除，作品画面本身不套用编辑器主题。

## 直接试用

1. 将 `release/PictureBookStudio-0.1.0-win32-x64.zip` 完整解压到普通应用目录（例如 `E:/Apps`），再打开其中的 `PictureBookStudio.exe`，保留同目录其他文件。本机 2026-10-30 已验证的试用副本位于 `E:/Test/PictureBookStudio/PictureBookStudio.exe`；后续新版统一放这里并删除旧版。
2. 点击“打开”，选择同目录 `示例工程/林间来信/project.json`。
3. 双击页面卡片编辑图片、文字、图层和声音；返回流程配置出口；点击“从头预览”。
4. 新建工程时选择名称、画布尺寸和空文件夹。导入的素材会复制到工程 `assets/`；搬移作品时复制整个工程文件夹。

当前支持图片 PNG/JPEG/静态 WebP，以及 MP3、PCM WAV、AAC M4A 样本；单文件导入上限 50 MB。每页背景音频循环、人物配音播放一次；图层淡入和页面交叉淡化可选。示例音频为测试音，用于区分两条音轨。

**不要直接运行本机受隔离的开发工作区中的 EXE。** 本机工作区会让产物继承 Windows 低完整性标签，导致 Electron 沙箱初始化或 GPU 进程失败，表现为无窗口、退出码 `0x80000003`；管理员启动也不能修正该标签。将便携包解压到普通目录，不要解压回该工作区。无需关闭 Windows 防护、修改工作区 ACL 或使用 `--no-sandbox`。

撤销/重做只在本次打开期间有效。保存使用 Ctrl+S，撤销 Ctrl+Z，重做 Ctrl+Shift+Z。新建、打开和保存位于“文件”功能区；流程／页面工作区切换右侧固定“▶ 预览”，下拉可选择从头或从当前页开始。隐藏图层可在左侧列表恢复；页面删除可连同关联出口撤销。工程草稿可以没有起点或保留未连接出口，界面会提示。

## 开发运行

需要 Node.js 24 和 npm。依赖版本以 `package-lock.json` 为准。

```powershell
npm ci
npm run build
npm start
npm test
npm run test:electron
npm run test:integration
npm run package
```

- `npm run build`：类型检查、React 生产构建、Electron 和 MCP bridge 构建。
- `npm run test:electron`：真实 Electron 编辑与分支循环预览。工作区受低完整性标签影响时，可用 `STUDIO_EXECUTABLE=<普通目录中的 EXE>` 指向已解压副本。
- `npm run test:edge-colors`：真实 Electron 检查前进／循环／后退三类连线颜色和图例。
- `npm run test:ribbon-window`：真实 Electron 检查 Windows 标题栏、六类功能区、转场／动画设置与预览包裹布局。
- `npm run test:topbar-preview`：真实 Electron 检查工程／未保存标题、文件功能区、固定预览入口、菜单键鼠操作及 1000／1440 窗口缩放。
- `npm run test:integration`：六种媒体样本、MCP 协议、冲突、撤销及快照验证；同样支持 `STUDIO_EXECUTABLE`。
- `npm run test:agent`：调用本机已登录的真实 Codex CLI，仅操作临时测试工程；会使用模型额度，不是普通单元测试。
- `node scripts/ui-acceptance.mjs`、`playback-acceptance.mjs`、`flush-acceptance.mjs`：完整制作、音画生命周期/异常、未失焦输入保存回归。

## Agent 接入

不内置聊天或模型。见 [外部 Agent 工具说明](docs/agent-tools.md)。先在桌面工具打开工程，按需授权素材目录，再让外部宿主连接本地 MCP bridge。

## 状态与边界

Windows x64 应用包已生成；功能证据、环境限制和未完成验收项见本地验收记录（不提交远程仓库）。2026-10-29 已定位工作区低完整性标签造成的启动问题；同一程序部署到普通目录后，默认 GPU/沙箱的真实 Electron 编辑和分支预览回归通过。此前“需关闭沙箱才能自动化”的记录是受影响目录下的历史结果，不再作为交付方式。真实系统 DPI 与用户体验仍待人工验收。

本版不包含视频、隐藏数值/条件系统、云同步、作品独立网页或游戏发布。源码已推送到私有 GitHub 仓库 [Viter001/picture-book-studio](https://github.com/Viter001/picture-book-studio)；未上传安装包或创建公开 Release。

## 项目文档与问题

- [全局设计与发展规划](docs/product-roadmap.md)
- [MVP 实施基线 v0.7](docs/product-plan-mvp.md)
- [外部 Agent 工具说明](docs/agent-tools.md)
- [GitHub Issues](https://github.com/Viter001/picture-book-studio/issues)：同步当前待裁决、反馈和待办。

项目协作约定、决策全文、反馈详情、开发/讨论记录、实施计划、验收证据和截图属于本地管理记录，已加入 `.gitignore`，不提交到 GitHub。当前未关闭事项以 GitHub Issues 为准。DSH 已提供接入步骤，尚无已安装或连接成功的实测记录；见 [DSH 接入](docs/agent-tools.md#dsh)。

原绘本 `E:/code saving/INTERACTIVE-NARRATIVE-SYSTEM/` 只作参考，本次未修改。项目使用已安装的 project-change-delivery 技能，代码与记录通过私有 GitHub 仓库管理。
