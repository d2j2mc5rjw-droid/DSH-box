# DSH-box · DeepSeek Harness in Box

**开箱即用的 DeepSeek Harness 桌面版。** 双击图标，进度条走完，直接进入 DeepSeek Harness 聊天界面 —— 与浏览器中完全相同的 UI，无需终端、无需命令行。

![DSH-box](docs/splash-preview.png)

## ✨ 特性

- 🚀 **一键启动**：原生窗口内自动拉起 Harness 内核，启动进度实时可见
- 💬 **原汁原味**：直接加载官方 Web UI（127.0.0.1:3080），体验与浏览器版一致
- 🔌 **自带内核**：打包生产化部署树（含自定义 LLM 插件），不依赖系统 Node
- 🔁 **单实例**：重复点击只会唤醒已有窗口
- 🧩 **内置插件**：`llm-deepseek-web`（DeepSeek 网页版适配器）+ `llm-ollama`（本地 Ollama 适配器）

## 📦 下载安装

前往 [Releases](https://github.com/d2j2mc5rjw-droid/DSH-box/releases) 下载对应平台安装包：

| 平台 | 格式 |
|---|---|
| macOS (Apple Silicon) | `DSH-box-x.y.z-arm64.dmg` |
| macOS (Intel) | `DSH-box-x.y.z.dmg` |
| Windows | `DSH-box Setup x.y.z.exe` |
| Linux | `DSH-box-x.y.z.AppImage` / `.deb` |

> 首次打开 macOS 提示"无法验证开发者"：右键 → 打开，或在"系统设置 → 隐私与安全性"中允许。

## 🔨 从源码构建

### 前置要求

- Node.js ≥ 20（含 corepack）
- 本地已克隆 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 源码并完成过一次构建（用于生成内核；CI 会自动克隆）

### 步骤

```sh
git clone https://github.com/d2j2mc5rjw-droid/DSH-box.git
cd DSH-box

# 1. 从本地 harness 源码同步生产内核到 resources/harness/
npm run sync:harness            # 默认使用 ~/deepseek-harness，可传参指定目录

# 2. 安装桌面壳依赖
npm install

# 3. 开发运行
npm start

# 4. 打包当前平台安装包（输出至 release/）
npm run dist
```

多平台产物可由 GitHub Actions 自动构建：推送 `v*` 标签即在 Release 附上全平台安装包。

### 内核版本升级

`resources/harness` 不入库。升级 Harness 后重新执行：

```sh
npm run sync:harness
```

或修改 `.github/workflows/build.yml` 中 `DSH_REF` 环境变量后打标签发布。

## 🏗️ 架构

```
┌─────────────────────────────────────┐
│           DSH-box (Electron)        │
│                                     │
│  splash ──▶ 进度条 ──▶ 主窗口       │
│                 │          │        │
│                 ▼          ▼        │
│   ELECTRON_RUN_AS_NODE   加载       │
│   启动 dsh web 内核    127.0.0.1:3080│
└─────────────────────────────────────┘
```

- 主进程以 `ELECTRON_RUN_AS_NODE=1` 复用 Electron 自带 Node 运行内核，无需单独安装 Node.js
- 若检测到 3080 端口已有健康的 Harness 服务，直接接入不重复启动

## ⚠️ 已知限制

- 应用未做 Apple 公证（个人项目），首次打开需手动放行
- Windows/Linux 包由 CI 构建，内核为上游官方版本 + 本仓库自带插件补丁

## 📄 许可证

[MIT](LICENSE)。本应用仅为社区独立打包，与 DeepSeek AI 官方无关；
所封装的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 同样基于 MIT 开源。
