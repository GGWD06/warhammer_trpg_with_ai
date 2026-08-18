# 战锤 40K AI 跑团机器人 (MVP)

这是一个基于 Next.js、Node.js 和 Socket.io 构建的《战锤 40K》跑团 (TRPG) 机器人系统。本项目集成了轻量级的 PbtA（Powered by the Apocalypse）规则机制，由大模型（目前对接 OpenRouter）提供动态的意图解析与跑团叙事生成。

## 项目结构
- `apps/web`: 前端应用 (Next.js + TailwindCSS)
- `apps/server`: 后端服务 (Node.js + Express + Socket.io)
- `packages/shared`: 共享的 TypeScript 核心类型定义（前后端共用）

## 快速启动指南

### 1. 前置环境要求
- Node.js (推荐 v18 或以上版本)
- pnpm 包管理器 (全局安装: `npm install -g pnpm`)

### 2. 配置 API Key
本项目依赖于 OpenRouter 提供的 AI 能力来解析意图和生成叙事。在启动项目之前，您必须先配置 API Key：
1. 进入后端目录：`apps/server`。
2. 找到 `.env` 文件（如果没有，请手动创建）。
3. 将您在 OpenRouter 申请的 API Key 填入：
   ```env
   PORT=3001
   OPENROUTER_API_KEY=在此处填入您的真实_API_KEY
   ```

### 3. 安装依赖
返回项目的根目录（即本 README 所在的文件夹），运行一次依赖安装：
```bash
pnpm install
```

### 4. 启动开发服务器
在根目录下，使用一条命令即可同时启动前端、后端，并自动监视公共包(`packages/shared`) 的变化：
```bash
pnpm dev
```

启动成功后，您应该能在终端看到如下提示：
- Backend (Server): `Server is running on http://localhost:3001`
- Frontend (Web): 启动在 `http://localhost:3000`

### 5. 开始体验
1. 打开浏览器访问 [http://localhost:3000](http://localhost:3000)
2. 在大厅点击 **"Initiate Link"** 建立新的房间会话。
3. 在随后打开的房间界面中选择一名**审判官附属小队**的特工。
4. 在右侧聊天栏用文字表达您的意图，按下回车发送！
5. 稍等片刻（目前缓冲设定为 10 秒），系统会自动识别是否需要骰子检定、暗投结果，并结合您的动作自动生成《战锤 40K》风格的跑团反馈。

---
*The Emperor Protects.*
