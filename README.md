# Black Hole Recycle Bin

English | [中文](README.zh-CN.md)

Interstellar-style desktop black-hole recycle bin (Electron) for Windows / macOS. Drop files in to send them to the system Recycle Bin / Trash.

Repositories:
- Gitee (releases / auto-update): [gitee.com/dong-tianyi-11/black-hole-recycle-bin](https://gitee.com/dong-tianyi-11/black-hole-recycle-bin)
- GitHub: [github.com/dong-tianyi-11/Black-Hole-Recycle-Bin](https://github.com/dong-tianyi-11/Black-Hole-Recycle-Bin)

Built-in skins: **Black Hole**, **Saturn**, **Calico Cat**, **Danchen (Alchemy Boy)**. Supports custom themes and **Gitee auto-update** (GitHub mirrors the installers).

## Permanent download links

URLs stay the same; each release overwrites the same-named installers. **Click to download — no build required.**  
Current version **v1.1.4** (Windows + macOS arm64 / Intel).

| Platform | Download (GitHub recommended) | Mirror |
|----------|-------------------------------|--------|
| Windows x64 | [Direct download](https://github.com/dong-tianyi-11/Black-Hole-Recycle-Bin/releases/latest/download/BlackHoleRecycleBin-Windows-x64.exe) | [Gitee](https://gitee.com/dong-tianyi-11/black-hole-recycle-bin/releases/download/latest/BlackHoleRecycleBin-Windows-x64.exe) |
| macOS Apple Silicon (M series) | [Direct download .dmg](https://github.com/dong-tianyi-11/Black-Hole-Recycle-Bin/releases/latest/download/BlackHoleRecycleBin-macOS-arm64.dmg) | Same (Gitee ~100MB file limit — use GitHub for Mac) |
| macOS Intel | [Direct download .dmg](https://github.com/dong-tianyi-11/Black-Hole-Recycle-Bin/releases/latest/download/BlackHoleRecycleBin-macOS-x64.dmg) | Same (use GitHub) |

Plain URLs:

```text
https://github.com/dong-tianyi-11/Black-Hole-Recycle-Bin/releases/latest/download/BlackHoleRecycleBin-Windows-x64.exe
https://github.com/dong-tianyi-11/Black-Hole-Recycle-Bin/releases/latest/download/BlackHoleRecycleBin-macOS-arm64.dmg
https://github.com/dong-tianyi-11/Black-Hole-Recycle-Bin/releases/latest/download/BlackHoleRecycleBin-macOS-x64.dmg
```

Installed users can also use: tray → **Check for updates** (Windows reads Gitee `latest`; macOS opens the release page).

## System requirements

| Platform | Minimum | Notes |
|----------|---------|-------|
| Windows | **Windows 10** x64 (and later) | Chromium/Electron — Win7/8/8.1 not supported |
| macOS | **11 Big Sur** or later | Intel (x64) and Apple Silicon (arm64) installers |

Config and API keys live under the user data folder (`%APPDATA%\black-hole-recycle-bin` / `~/Library/Application Support/black-hole-recycle-bin`). **Updates do not wipe them.**

## Built-in skins

| Skin | Type | Notes |
|------|------|-------|
| Black Hole | Canvas | Gravitational lens / accretion disk; dropped files spin, shred, and enter the Recycle Bin |
| Saturn | Canvas | Matte planet + ring rocks; rock count follows Recycle Bin item count |
| Calico Cat | Desktop pet | Poke, eat files, typing, listening sway, edge mini mode |
| Danchen | Desktop pet | Alchemy typing, listening, eat files, edge mini (light motion) |

Pets show “working / alchemy” while typing and “listening” when the system plays music. Priority: **typing > listening > idle**. Do Not Disturb / mini enter-exit restores the correct face automatically.

## Controls

| Action | Effect |
|--------|--------|
| Left-drag | Move; **fling past the left/right screen edge** and release to enter mini mode (near-edge alone does not snap) |
| Mini mode | Half-hidden in the screen edge; hover peeks out; click / drag out / tray exits |
| Left-click | Cat poke / wake (in mini mode: exit mini) |
| Scroll wheel | Zoom in / out (center-anchored to reduce jump) |
| Drop files | Ingest / eat → Recycle Bin / Trash (Win / Mac) |
| Tray | Skins, Do Not Disturb, multi-monitor, launch at login, screen-recording visibility, size, shrink to base size, check for updates, etc. |

> **Screen recording**: Cat / Danchen / Saturn are visible to EV, OBS, etc. by default. Black Hole excludes itself from capture while refreshing the desktop warp; to record Black Hole, enable **Visible in screen recording** in the tray.

## Custom themes

Tray → **Skin**:

1. **AI settings (API Key)…** — Enter your own key. Built-in presets: **DeepSeek** (default; text-description generation), SiliconFlow / Alibaba Bailian / Zhipu / Kimi / Yi / Baichuan / Volcengine Ark / Hunyuan / Qianfan, plus OpenRouter and OpenAI. Use **Test connection**. Direct OpenAI/Claude/Gemini endpoints are often blocked in mainland China — prefer domestic presets there.  
2. **Generate theme from image…** — Preflights the API first; vision models can use the image, and a **text description is always collected as fallback** (used automatically if vision fails or the gateway blocks).  
3. **Import theme package (.zip)…** — Import an existing theme pack  

DeepSeek Base URL example: `https://api.deepseek.com/v1`, model: `deepseek-chat`.  

API keys are stored encrypted via the OS (Windows DPAPI / macOS Keychain) in `ai-secrets.json` — not plain-text in `config.json`, and not shipped in the installer.

User themes folder:

- Windows: `%APPDATA%\black-hole-recycle-bin\themes\`
- macOS: `~/Library/Application Support/black-hole-recycle-bin/themes/`

## Changelog

### v1.1.4
- AI theme generation: domestic provider presets (DeepSeek default, etc.) with preflight before generate
- Early warning for overseas endpoints that are often gateway-blocked; fail fast on HTML block pages and suggest domestic presets
- Auto-fallback to text description when vision fails; description dialog packaged in the installer

### v1.1.3
- Saturn ring: irregular brighter rock particles (less like light dots)
- Smoother Black Hole / Saturn recycle FX (softer spiral ingest, rocks settle into the ring)
- Calico listening: new headphone art + light bob and music notes
- Danchen mini: edge bob + sparkles, slightly smaller
- Fix typing / alchemy occasionally stuck on work face (ignore ghost key events)

### v1.1.2
- Saturn: less plastic lighting; matte gaseous look
- Ring rocks as high-contrast light points (dark outline + gold glow) for light desktops
- Softer ring / planet shadows so ring points stand out

### v1.1.1
- Black Hole recycle FX: shred/spin only after drop (not while hovering)
- Paper-fragment shred instead of glow particles
- Fix window jumping before grow when feeding
- Mini mode: require a strong fling past the edge (no near-edge snap)
- Fix tiny hit target after mini dock (hard to drag / exit)
- Grow animation locks center to avoid transparent-window jump

### v1.1.0
- Screen-recording visibility: Cat / Danchen / Saturn visible to EV, OBS, etc. by default
- Tray toggle **Visible in screen recording**; enable for Black Hole when recording
- Fix pet state overwrite: typing / listening / idle priority restored correctly
- Fix missing Calico mini asset in the packaged app

### v1.0.13
- Fix pet state overwrite: typing / listening / idle priority restored correctly
- Fix missing Calico mini asset in the packaged app
- Keep mini and typing animations in the build; re-sync face after theme switch, DND, and mini exit

### v1.0.12
- Saturn: planet rotation (bands / storms) and slight ring drift

### v1.0.11
- Clean temporary assets; smoother drag and edge mini enter/exit

### v1.0.10
- Saturn: Recycle Bin count drives ring debris; grow on feed

### v1.0.9
- Danchen theme; Calico eat-file SVG; typing / listening states

## Development

```bash
npm install
npm start
```

## Build & publish (maintainers)

End users should use the download links above — no local build needed.

```bash
# 1) Bump package.json version and README version
# 2) Push to GitHub master, then run the Build workflow in Actions
#    → builds Windows + macOS (arm64/x64) and refreshes latest download URLs
# 3) On Windows locally: npm run build:win && npm run publish:gitee && npm run publish:github
```

macOS installers are built by GitHub Actions (`macos-latest`) as `BlackHoleRecycleBin-macOS-arm64.dmg` / `BlackHoleRecycleBin-macOS-x64.dmg`.

### Testing auto-update

1. Install an older build (e.g. v1.0.13)
2. Confirm the Gitee `latest` release has the new installers and `latest.yml` (e.g. v1.1.2+)
3. Open the installed app → tray → **Check for updates** → download → restart

| Platform | Behavior |
|----------|----------|
| Windows installer | Tray “Check for updates” → read `latest.yml` → download → restart install |
| macOS installer | Opens the Gitee Releases page when a newer version is found |
| Dev mode `npm start` | Prompts to use the installed build for updates |

> Auto-update reads assets from the release tagged **`latest`**.
