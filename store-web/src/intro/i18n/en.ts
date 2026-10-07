/** English is the primary language, mirroring the Infinia docs and UI. */
export const en = {
  brand: {
    name: "Infinia",
    tagline: "AI-native orchestration",
  },
  nav: {
    features: "Features",
    surfaces: "Surfaces",
    how: "How it works",
    plugins: "Plugins",
    security: "Security",
    faq: "FAQ",
    download: "Download",
    store: "Store",
    docs: "Docs",
    langSwitch: "中文",
    langSwitchAria: "Switch to Simplified Chinese",
  },
  hero: {
    badge: "4.0.0 — web + desktop, one SPA",
    titleLead: "State a goal.",
    titleHighlight: "Infinia",
    titleTail: "orchestrates",
    words: ["plugins", "skills", "flows", "AI tools"],
    sub: "Infinia (蜂语 / FengYu) is an AI-native orchestration platform. A plan-and-execute Agent decomposes your request into steps and drives three extension surfaces — .fyp plugins, .fys skills and in-process AI tools — while every sensitive action waits for your explicit approval.",
    ctaDownload: "Download Infinia",
    ctaStore: "Open the Store",
    ctaDocs: "Read the docs",
    platforms: "Windows · macOS · Linux · portable web distribution",
    scroll: "Scroll to explore",
  },
  stats: [
    { value: "3", label: "extension surfaces" },
    { value: "4", label: "database backends" },
    { value: "25", label: "browser-agent AI tools" },
    { value: "100%", label: "local & loopback-only" },
  ],
  features: {
    eyebrow: "Features",
    heading: "One Agent. Every surface.",
    sub: "Everything below ships in the box: the host, its UI, and the official plugins the Agent can call from the first launch.",
    items: [
      {
        title: "The AI Agent spine",
        description:
          "A plan-and-execute Agent turns a natural-language goal into steps. Multi-backend — Ollama, OpenAI, Anthropic, DeepSeek — with streaming, thinking cards, tool calls and automatic long-conversation compaction.",
      },
      {
        title: "FengyuFlow canvas",
        description:
          "Build visual DAGs, bind fields to upstream results, recover local drafts — or ask the docked assistant to propose a whole graph and review the diff before it applies.",
      },
      {
        title: "Sandboxed .fyp plugins",
        description:
          "A zip of manifest + sandboxed iframe UI + out-of-process JSON-RPC worker in Java, Python or Go. A worker crash can never take the host down; updates are health-gated and rollback-safe.",
      },
      {
        title: ".fys skills",
        description:
          "Codex-style progressive disclosure: enabled skills appear as a compact catalog in the system prompt and their full body loads on demand through the built-in skill tool.",
      },
      {
        title: "Browser Agent",
        description:
          "Host-embedded automation that drives real tabs through Electron's native engine — 25 effect-classified AI tools, isolated contexts, multimodal screenshots. No Chromium download.",
      },
      {
        title: "Computer Use",
        description:
          "ChatGPT-desktop-style screen control built into desktop builds: vision-ready captures, then mouse, keyboard and app focus — every input action gated by your per-turn approval.",
      },
    ],
  },
  surfaces: {
    eyebrow: "Extension surfaces",
    heading: "Three ways to teach the Agent something new",
    sub: "Plugins carry capability, skills carry procedure, and anything can become an AI tool the Agent plans with.",
    items: [
      {
        title: ".fyp Plugins",
        description:
          "Signed, integrity-checked packages with a micro-frontend UI and an isolated JSON-RPC worker. Scaffolded with fengyu init --runtime java|python|go, validated with fengyu check, packed with fengyu build.",
        link: "/plugins",
      },
      {
        title: ".fys Skills",
        description:
          "Domain knowledge and procedures as progressive-disclosure packages. Drop them on the Plugins page — one Upload button accepts .fyp and .fys — and the Agent loads them only when relevant.",
        link: "/skills",
      },
      {
        title: "Flows → AI tools",
        description:
          "Publish any workflow from the canvas as a dynamically discovered AI tool. The Agent then calls it like any built-in, with the same approvals, SSE events and durable history.",
        link: "/how",
      },
    ],
  },
  manifesto:
    "Your machine. Your data. Your approval. The backend binds to loopback only, every request carries a per-launch token, and the Agent never touches the outside world without asking you first.",
  how: {
    eyebrow: "How it works",
    heading: "From sentence to system, in five steps",
    sub: "The same runner serves chat, the canvas and published flows — approvals, SSE events and durable history included.",
    steps: [
      {
        title: "State your goal",
        description:
          "Plain language in the chat — 'split this workbook by region and email each office'. No wiring, no scripts.",
      },
      {
        title: "The Agent plans",
        description:
          "The plan-and-execute spine decomposes the goal into steps and picks the best-fit surface for each: a plugin, a skill, an AI tool or a flow.",
      },
      {
        title: "Surfaces execute",
        description:
          "Plugin workers run out-of-process over JSON-RPC; flows run on the same engine as the canvas; browser and screen tools act through the desktop shell.",
      },
      {
        title: "You approve",
        description:
          "Anything that touches the outside world — sending email, writing files, mutating data — stops and waits for your explicit, confirmation-first approval.",
      },
      {
        title: "Results flow back",
        description:
          "Outputs return into the conversation, the Agent re-plans on failure, and every run leaves durable, reviewable history.",
      },
    ],
  },
  plugins: {
    eyebrow: "Official plugins",
    heading: "Ships with a toolbox, not a blank slate",
    sub: "Built-in tools live as official plugins the Agent can call — each one sandboxed exactly like a third-party .fyp.",
    cta: "Build your own →",
    cards: [
      {
        quote: "Split workbooks by sheet, column value or complex rules.",
        name: "Excel Splitter",
        title: "Official plugin · 6 AI tools",
      },
      {
        quote: "Multi-account SMTP/IMAP with filename-tag batch sending.",
        name: "Email Center",
        title: "fan.summer.email · 9 confirmation-first AI tools",
      },
      {
        quote: "Split-pane editing with isolated server-side rendering.",
        name: "Markdown Editor",
        title: "Official plugin",
      },
      {
        quote: "Air-gap-ready Python wheelhouses built as an async job.",
        name: "Offline Python Builder",
        title: "Official plugin · pip download resolution",
      },
      {
        quote: "Scaffold, simulate, check and package from your IDE.",
        name: "Your plugin here",
        title: "fengyu init --runtime java|python|go",
      },
    ],
  },
  security: {
    eyebrow: "Security & privacy",
    heading: "Paranoid by architecture, not by policy",
    sub: "The trust story is the topology: nothing listens on the network unless you decide it should.",
    bullets: [
      {
        title: "Loopback-only backend",
        description:
          "The Spring Boot server binds 127.0.0.1:24056 and is unreachable from other machines. No cloud relay, no telemetry sink.",
      },
      {
        title: "Per-launch token",
        description:
          "Every request except health, setup and plugin assets must carry the X-FengYu-Token header minted at launch.",
      },
      {
        title: "Crash-proof workers",
        description:
          "Plugin workers live outside the host process over stdio JSON-RPC — a segfault in a worker is an observable fault, never a host crash.",
      },
      {
        title: "Approval-first tools",
        description:
          "Email, filesystem and data mutations are confirmation-first AI tools; Computer Use adds a Settings master switch plus per-turn gates.",
      },
      {
        title: "Encrypted credentials",
        description:
          "Database and mailbox passwords are AES-GCM encrypted, machine-bound, and stored under your program working directory.",
      },
    ],
    keyLabel: "The whole attack surface",
    keyValue: "127.0.0.1:24056",
    keyNote: "Loopback, token-gated, with a first-launch setup wizard before APP mode.",
  },
  downloads: {
    eyebrow: "Get Infinia",
    heading: "One platform, three shells",
    sub: "Release builds ship two variants per platform: a lightweight one that uses the Java 21+ on your PATH, and a self-contained one bundling a jlink-minimized JRE.",
    cards: [
      {
        os: "Windows",
        detail: "NSIS installer with tray, file logging and the GitHub-Releases auto-updater.",
        cta: "Download for Windows",
      },
      {
        os: "macOS",
        detail: "DMG image, Apple-silicon and Intel, light or bundled-JRE. Code signing is on the roadmap.",
        cta: "Download for macOS",
      },
      {
        os: "Linux",
        detail: "AppImage and deb packages — same two variants, same auto-updating shell.",
        cta: "Download for Linux",
      },
    ],
    webTitle: "…or run the portable web distribution",
    webDetail:
      "Unzip Infinia-<version>-web.zip and run ./run.sh (or run.bat). Needs Java 21; the backend still binds loopback only. Ideal for trying Infinia on a server you already own.",
    webCta: "Grab the web zip",
    allReleases: "All releases",
  },
  faq: {
    eyebrow: "FAQ",
    heading: "Questions, answered",
    sub: "The short version — the docs carry the long one.",
    items: [
      {
        q: "Does my data leave my machine?",
        a: "No. The backend binds loopback only and every database choice — H2, SQLite, MySQL, PostgreSQL — is one you configure locally. The only outbound calls are the AI backends you explicitly configure (Ollama can keep inference fully offline).",
      },
      {
        q: "Which AI backends are supported?",
        a: "Ollama, OpenAI, Anthropic and DeepSeek, with streaming, thinking cards, tool calls and automatic long-conversation compaction. Switch backends per conversation.",
      },
      {
        q: "Can a plugin break the host?",
        a: "The UI runs in a sandboxed iframe behind a postMessage bridge; the worker is a separate process speaking newline-delimited JSON-RPC 2.0. A worker crash is observable and recoverable — it can never take down the Spring context.",
      },
      {
        q: "What can the Agent do on my machine?",
        a: "Browser Agent drives real tabs and Computer Use drives the real screen, both desktop-only and both approval-gated: every input action needs your per-turn approval, with a Settings master switch to disable them outright.",
      },
      {
        q: "How do I write my own plugin?",
        a: "Install the toolchain and run fengyu init --runtime java|python|go. You get a manifest, a UI scaffold with typed @infinia/plugin-sdk bindings, and a worker skeleton. fengyu dev simulates the host in your IDE; fengyu check validates; fengyu build packs the .fyp.",
      },
      {
        q: "Desktop and web — what's the difference?",
        a: "The Vue 3 SPA is identical in both. The Electron shell sidecar-launches the Java backend and adds tray, native dialogs and the auto-updater; the portable web zip runs the same backend on any machine with Java 21.",
      },
    ],
  },
  cta: {
    heading: "Put your busywork on autopilot",
    sub: "Free, open source under GPL-3.0, and running on your own hardware in minutes.",
    primary: "Download Infinia",
    secondary: "Star on GitHub",
  },
  footer: {
    blurb:
      "Infinia (蜂语 / FengYu) — an AI-native orchestration platform built with Spring Boot, Vue 3 and Electron. Local-first, approval-gated, yours.",
    productTitle: "Product",
    product: [
      { label: "Features", href: "#features" },
      { label: "Extension surfaces", href: "#surfaces" },
      { label: "How it works", href: "#how" },
      { label: "Downloads", href: "#downloads" },
      { label: "FAQ", href: "#faq" },
    ],
    resourcesTitle: "Resources",
    resources: [
      { label: "Documentation", href: "DOCS" },
      { label: "AI Agent guide", href: "AGENT" },
      { label: "Plugin overview", href: "PLUGINS" },
      { label: "Architecture", href: "ARCH" },
      { label: "Changelog", href: "CHANGELOG" },
    ],
    ecosystemTitle: "Ecosystem",
    ecosystem: [
      { label: "GitHub repository", href: "GITHUB" },
      { label: "Release downloads", href: "RELEASES" },
      { label: "Infinia Store — browse the catalog", href: "STORE" },
      { label: "Issue tracker", href: "ISSUES" },
    ],
    legal: "GPL-3.0 licensed. The website itself is part of the same repository.",
    rights: "Built with ❤️ using Spring Boot, Vue 3, and Electron.",
  },
  docs: {
    title: "Documentation",
    searchPlaceholder: "Filter pages…",
    noMatches: "No pages match.",
    onThisPage: "On this page",
    menu: "Browse docs",
    notFound: "Page not found",
    notFoundHint: "This page does not exist in the docs bundle — it may have been renamed or moved.",
    backHome: "Back to docs home",
    prev: "Previous",
    next: "Next",
    editPage: "Edit this page",
    syncedFrom: (ref: string) => `Synced from the FengYu docs (${ref}).`,
  },
};

export type Dictionary = typeof en;
