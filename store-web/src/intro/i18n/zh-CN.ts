import type { Dictionary } from "./en";

/** 简体中文 — mirrors the localized Infinia UI (docs are English-first). */
export const zhCN: Dictionary = {
  brand: {
    name: "Infinia",
    tagline: "AI 原生编排平台",
  },
  nav: {
    features: "功能",
    surfaces: "扩展面",
    how: "工作原理",
    plugins: "插件",
    security: "安全",
    faq: "常见问题",
    download: "下载",
    store: "商店",
    docs: "文档",
    langSwitch: "English",
    langSwitchAria: "Switch to English",
  },
  hero: {
    badge: "4.0.0 — Web + 桌面，同一套 SPA",
    titleLead: "说出你的目标，",
    titleHighlight: "Infinia",
    titleTail: "替你编排",
    words: ["插件", "技能", "工作流", "AI 工具"],
    sub: "Infinia（蜂语 / FengYu）是一个 AI 原生编排平台。规划-执行型 Agent 将你的需求拆解成步骤，调度三类扩展面——.fyp 插件、.fys 技能与进程内 AI 工具——而每一个敏感操作都会先等待你的明确批准。",
    ctaDownload: "下载 Infinia",
    ctaStore: "进入商店",
    ctaDocs: "阅读文档",
    platforms: "Windows · macOS · Linux · 便携 Web 发行版",
    scroll: "向下滚动探索",
  },
  stats: [
    { value: "3", label: "扩展面" },
    { value: "4", label: "数据库后端" },
    { value: "25", label: "浏览器 Agent AI 工具" },
    { value: "100%", label: "本地运行 · 仅回环" },
  ],
  features: {
    eyebrow: "功能",
    heading: "一个 Agent，调度所有扩展面",
    sub: "以下能力全部开箱即用：宿主、UI，以及 Agent 从首次启动就能调用的官方插件。",
    items: [
      {
        title: "Agent 主轴",
        description:
          "规划-执行型 Agent 把自然语言目标变成步骤。多后端——Ollama、OpenAI、Anthropic、DeepSeek——支持流式输出、思考卡片、工具调用与长对话自动压缩。",
      },
      {
        title: "FengyuFlow 画布",
        description:
          "搭可视化 DAG，把字段绑定到上游结果，本地草稿随时恢复——也可以让停靠助手直接提出整张图，先看 diff 再确认应用。",
      },
      {
        title: "沙箱化 .fyp 插件",
        description:
          "一个 zip：manifest + 沙箱 iframe UI + Java/Python/Go 进程外 JSON-RPC worker。worker 崩溃拖不垮宿主；更新有健康门禁，可安全回滚。",
      },
      {
        title: ".fys 技能",
        description:
          "Codex 式渐进披露：启用的技能在系统提示里只是一份紧凑目录，完整正文由内置 skill 工具按需加载。",
      },
      {
        title: "浏览器 Agent",
        description:
          "宿主内嵌的自动化能力，通过 Electron 原生引擎驱动真实标签页——25 个按效果分级的 AI 工具、隔离上下文、多模态截图，无需另下 Chromium。",
      },
      {
        title: "Computer Use",
        description:
          "桌面版内置的 ChatGPT-desktop 式屏幕控制：视觉截图之后移动鼠标、敲键盘、聚焦应用——每个输入操作都要过你的逐轮批准。",
      },
    ],
  },
  surfaces: {
    eyebrow: "扩展面",
    heading: "三种方式教会 Agent 新本领",
    sub: "插件承载能力，技能承载规程，而任何东西都能变成 Agent 规划时可以调用的 AI 工具。",
    items: [
      {
        title: ".fyp 插件",
        description:
          "带签名、可校验完整性的包：微前端 UI + 隔离的 JSON-RPC worker。fengyu init --runtime java|python|go 起步，fengyu check 校验，fengyu build 打包。",
        link: "/plugins",
      },
      {
        title: ".fys 技能",
        description:
          "把领域知识与操作规程做成渐进披露包。放到插件页即可——一个上传按钮同时接受 .fyp 与 .fys——Agent 只在相关时才加载。",
        link: "/skills",
      },
      {
        title: "流程 → AI 工具",
        description:
          "把画布上的任意工作流发布为动态发现的 AI 工具。Agent 会像调用内置工具一样调用它，走同一套批准、SSE 事件与持久历史。",
        link: "/how",
      },
    ],
  },
  manifesto:
    "你的机器，你的数据，你的批准权。后端只绑定回环地址，每个请求都携带按次启动签发的令牌，Agent 不先问你就不碰外部世界。",
  how: {
    eyebrow: "工作原理",
    heading: "从一句话到一套流程，只需五步",
    sub: "聊天、画布与已发布流程共用同一个执行器——批准、SSE 事件与持久历史一应俱全。",
    steps: [
      {
        title: "说出目标",
        description:
          "在聊天里用大白话讲——“按地区拆分这个工作簿，然后给各办事处发邮件”。不用接线，不用写脚本。",
      },
      {
        title: "Agent 规划",
        description:
          "规划-执行主轴把目标拆成步骤，并为每一步挑选最合适的扩展面：插件、技能、AI 工具或流程。",
      },
      {
        title: "扩展面执行",
        description:
          "插件 worker 以进程外 JSON-RPC 运行；流程与画布共用同一引擎；浏览器与屏幕工具通过桌面壳采取行动。",
      },
      {
        title: "你来批准",
        description:
          "凡是触碰外部世界的动作——发邮件、写文件、改数据——都会停下来，等待你明确的、确认优先的批准。",
      },
      {
        title: "结果回流",
        description:
          "输出回到对话中，失败时 Agent 自动重新规划，每次运行都留下可回溯的持久历史。",
      },
    ],
  },
  plugins: {
    eyebrow: "官方插件",
    heading: "出厂自带工具箱，而非一张白纸",
    sub: "内置工具以官方插件形式存在、供 Agent 调用——每个都被沙箱化，与第三方 .fyp 毫无差别。",
    cta: "构建你自己的 →",
    cards: [
      {
        quote: "按工作表、列取值或复杂规则拆分工作簿。",
        name: "Excel Splitter",
        title: "官方插件 · 6 个 AI 工具",
      },
      {
        quote: "多账户 SMTP/IMAP，文件名标签批量发送。",
        name: "邮件中心",
        title: "fan.summer.email · 9 个确认优先的 AI 工具",
      },
      {
        quote: "分栏编辑，服务端渲染完全隔离。",
        name: "Markdown 编辑器",
        title: "官方插件",
      },
      {
        quote: "以异步任务构建可物理隔离的 Python wheelhouse。",
        name: "离线 Python 构建",
        title: "官方插件 · pip download 全量解析",
      },
      {
        quote: "在 IDE 里脚手架、模拟、校验并打包。",
        name: "下一个是你？",
        title: "fengyu init --runtime java|python|go",
      },
    ],
  },
  security: {
    eyebrow: "安全与隐私",
    heading: "偏执写在架构里，而不是写在口号里",
    sub: "信任模型就是拓扑本身：除非你决定开放，否则没有任何东西监听网络。",
    bullets: [
      {
        title: "仅回环的后端",
        description:
          "Spring Boot 服务绑定 127.0.0.1:24056，其他机器无法触达。没有云中继，没有遥测收集器。",
      },
      {
        title: "按次启动令牌",
        description:
          "除健康检查、初始化与插件静态资源外，每个请求都必须携带启动时签发的 X-FengYu-Token 请求头。",
      },
      {
        title: "崩溃隔离的 worker",
        description:
          "插件 worker 运行在宿主进程之外，通过 stdio JSON-RPC 通信——worker 段错误是可观测的故障，绝不是宿主崩溃。",
      },
      {
        title: "批准优先的工具",
        description:
          "邮件、文件与数据变更都是确认优先的 AI 工具；Computer Use 另有设置总开关与逐轮门禁。",
      },
      {
        title: "加密的凭据",
        description:
          "数据库与邮箱密码使用 AES-GCM 加密并与机器绑定，保存在程序工作目录之下。",
      },
    ],
    keyLabel: "全部攻击面",
    keyValue: "127.0.0.1:24056",
    keyNote: "仅回环、令牌门禁，首次启动先经过设置向导才进入 APP 模式。",
  },
  downloads: {
    eyebrow: "获取 Infinia",
    heading: "一套平台，三种外壳",
    sub: "每个平台都有两种发布变体：轻量版使用你 PATH 里的 Java 21+，自包含版内置 jlink 精简 JRE。",
    cards: [
      {
        os: "Windows",
        detail: "NSIS 安装包，带系统托盘、文件日志与基于 GitHub Releases 的自动更新。",
        cta: "下载 Windows 版",
      },
      {
        os: "macOS",
        detail: "DMG 镜像，Apple 芯片与 Intel 双架构，轻量或内置 JRE。代码签名在路线图上。",
        cta: "下载 macOS 版",
      },
      {
        os: "Linux",
        detail: "AppImage 与 deb 包——同样的两种变体，同样会自动更新的桌面壳。",
        cta: "下载 Linux 版",
      },
    ],
    webTitle: "……或者运行便携 Web 发行版",
    webDetail:
      "解压 Infinia-<version>-web.zip 并运行 ./run.sh（或 run.bat）。需要 Java 21；后端依然只绑定回环。适合在已有服务器上试用 Infinia。",
    webCta: "获取 Web 压缩包",
    allReleases: "全部版本",
  },
  faq: {
    eyebrow: "常见问题",
    heading: "你想问的，都在这里",
    sub: "这里是简短版——长版在文档里。",
    items: [
      {
        q: "我的数据会离开这台机器吗？",
        a: "不会。后端只绑定回环，数据库选型——H2、SQLite、MySQL、PostgreSQL——全部由你在本地配置。唯一的外呼是你明确配置的 AI 后端（用 Ollama 甚至可以完全离线推理）。",
      },
      {
        q: "支持哪些 AI 后端？",
        a: "Ollama、OpenAI、Anthropic 与 DeepSeek，支持流式输出、思考卡片、工具调用与长对话自动压缩，可按会话切换。",
      },
      {
        q: "插件会把宿主搞挂吗？",
        a: "UI 运行在 postMessage 桥后面的沙箱 iframe 里；worker 是独立进程，走换行分隔的 JSON-RPC 2.0。worker 崩溃可观测、可恢复——永远波及不到 Spring 上下文。",
      },
      {
        q: "Agent 在我的电脑上能做什么？",
        a: "浏览器 Agent 驱动真实标签页，Computer Use 驱动真实屏幕；两者仅限桌面版，且都受批准门禁：每个输入操作都需要你的逐轮批准，设置里还有总开关可以直接禁用。",
      },
      {
        q: "怎么写自己的插件？",
        a: "装好工具链后运行 fengyu init --runtime java|python|go，会生成 manifest、带 @infinia/plugin-sdk 类型绑定的 UI 脚手架和 worker 骨架。fengyu dev 在 IDE 里模拟宿主；fengyu check 校验；fengyu build 打出 .fyp。",
      },
      {
        q: "桌面版和 Web 版有什么区别？",
        a: "Vue 3 SPA 在两者中完全一致。Electron 壳以 sidecar 方式启动 Java 后端，并提供托盘、原生对话框与自动更新；便携 Web 压缩包则能在任何有 Java 21 的机器上运行同一后端。",
      },
    ],
  },
  cta: {
    heading: "把杂活交给自动驾驶",
    sub: "自由软件，GPL-3.0 授权，几分钟内就能在你自己的硬件上跑起来。",
    primary: "下载 Infinia",
    secondary: "去 GitHub 点个星",
  },
  footer: {
    blurb:
      "Infinia（蜂语 / FengYu）——用 Spring Boot、Vue 3 与 Electron 构建的 AI 原生编排平台。本地优先，批准门禁，属于你。",
    productTitle: "产品",
    product: [
      { label: "功能", href: "#features" },
      { label: "扩展面", href: "#surfaces" },
      { label: "工作原理", href: "#how" },
      { label: "下载", href: "#downloads" },
      { label: "常见问题", href: "#faq" },
    ],
    resourcesTitle: "资源",
    resources: [
      { label: "文档", href: "DOCS" },
      { label: "AI Agent 指南", href: "AGENT" },
      { label: "插件总览", href: "PLUGINS" },
      { label: "系统架构", href: "ARCH" },
      { label: "更新日志", href: "CHANGELOG" },
    ],
    ecosystemTitle: "生态",
    ecosystem: [
      { label: "GitHub 仓库", href: "GITHUB" },
      { label: "版本下载", href: "RELEASES" },
      { label: "Infinia 商店 — 浏览目录", href: "STORE" },
      { label: "问题反馈", href: "ISSUES" },
    ],
    legal: "采用 GPL-3.0 授权。本官网与主项目同仓库交付。",
    rights: "用 ❤️ 与 Spring Boot、Vue 3、Electron 构建。",
  },
  docs: {
    title: "文档",
    searchPlaceholder: "筛选页面…",
    noMatches: "没有匹配的页面。",
    onThisPage: "本页目录",
    menu: "浏览文档",
    notFound: "页面不存在",
    notFoundHint: "文档包中没有这一页 —— 它可能已被重命名或移动。",
    backHome: "返回文档首页",
    prev: "上一篇",
    next: "下一篇",
    editPage: "在 GitHub 上编辑",
    syncedFrom: (ref: string) => `同步自 FengYu 文档仓库（${ref}）。`,
  },
};
