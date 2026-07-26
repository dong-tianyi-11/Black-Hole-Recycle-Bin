# 黑洞回收站 · Black Hole Recycle Bin

Interstellar 风格桌面黑洞回收站（Electron）：Windows / macOS。把文件拖进去送入系统回收站。

仓库：
- Gitee（发行版 / 自动更新）：[gitee.com/dong-tianyi-11/black-hole-recycle-bin](https://gitee.com/dong-tianyi-11/black-hole-recycle-bin)
- GitHub：[github.com/dong-tianyi-11/Black-Hole-Recycle-Bin](https://github.com/dong-tianyi-11/Black-Hole-Recycle-Bin)

内置皮肤：**黑洞**、**土星**、**三花小猫**、**炼丹少年**。支持自定义主题与 **Gitee 自动更新**（GitHub 同步镜像安装包）。

## 永久下载直链

链接固定不变，每次发版会覆盖同名安装包；点击即开始下载。

| 平台 | GitHub（推荐） | Gitee |
|------|----------------|-------|
| Windows x64（当前 **v1.1.1**） | [直接下载](https://github.com/dong-tianyi-11/Black-Hole-Recycle-Bin/releases/latest/download/BlackHoleRecycleBin-Windows-x64.exe) | [直接下载](https://gitee.com/dong-tianyi-11/black-hole-recycle-bin/releases/download/latest/BlackHoleRecycleBin-Windows-x64.exe) |
| macOS Apple Silicon (M 系列) | [直接下载](https://github.com/dong-tianyi-11/Black-Hole-Recycle-Bin/releases/latest/download/BlackHoleRecycleBin-macOS-arm64.dmg) | [直接下载](https://gitee.com/dong-tianyi-11/black-hole-recycle-bin/releases/download/latest/BlackHoleRecycleBin-macOS-arm64.dmg) |
| macOS Intel | [直接下载](https://github.com/dong-tianyi-11/Black-Hole-Recycle-Bin/releases/latest/download/BlackHoleRecycleBin-macOS-x64.dmg) | [直接下载](https://gitee.com/dong-tianyi-11/black-hole-recycle-bin/releases/download/latest/BlackHoleRecycleBin-macOS-x64.dmg) |

纯文本链接（可放进文档 / 官网）：

```text
https://github.com/dong-tianyi-11/Black-Hole-Recycle-Bin/releases/latest/download/BlackHoleRecycleBin-Windows-x64.exe
https://github.com/dong-tianyi-11/Black-Hole-Recycle-Bin/releases/latest/download/BlackHoleRecycleBin-macOS-arm64.dmg
https://github.com/dong-tianyi-11/Black-Hole-Recycle-Bin/releases/latest/download/BlackHoleRecycleBin-macOS-x64.dmg
```

已安装用户也可：托盘 → **检查更新**（读取 Gitee `latest` 发行版）。

## 系统要求

| 平台 | 最低版本 | 说明 |
|------|----------|------|
| Windows | **Windows 10** x64（及更高） | 受 Chromium/Electron 限制，无法再支持 Win7/8/8.1 |
| macOS | **11 Big Sur** 及以上 | 同时提供 Intel (x64) 与 Apple Silicon (arm64) 安装包 |

配置与 API Key 存放在用户目录（`%APPDATA%\black-hole-recycle-bin` / `~/Library/Application Support/black-hole-recycle-bin`），**更新安装不会清除**。

## 内置皮肤

| 皮肤 | 类型 | 说明 |
|------|------|------|
| 黑洞 | 画布 | 引力透镜 / 吸积盘；拖入文件旋转撕碎吸入回收站 |
| 土星 | 画布 | 自转云带 + 光环碎石；碎石数量随回收站增减 |
| 三花小猫 | 桌宠 | 戳一戳、吃文件、打字敲键盘、听歌、贴边迷你 |
| 炼丹少年 | 桌宠 | 炼丹打字、听歌、吃文件、贴边迷你 |

桌宠在键盘输入时显示「工作 / 炼丹」，系统在播音乐时显示「听歌」；二者优先级为 **打字 > 听歌 > 常态**，勿扰 / 迷你进出后会自动恢复正确表情。

## 操作

| 操作 | 效果 |
|------|------|
| 左键拖拽 | 移动；**用力拖出左右屏幕边缘**松手才进入迷你模式（靠近不会自动吸附） |
| 迷你模式 | 半身藏进边框；悬停探头；单击 / 拖出 / 托盘均可退出 |
| 左键单击 | 小猫戳一戳 / 唤醒（迷你模式下为退出迷你） |
| 滚轮 | 放大 / 缩小（以中心锚定，尽量不跳位） |
| 拖入文件 | 吸入 / 吃掉 → 回收站（Win / Mac） |
| 托盘 | 皮肤、勿扰、多屏、开机启动、录屏可见、尺寸、缩小到原尺寸、检查更新等 |

> **录屏**：小猫 / 炼丹 / 土星默认可被 EV、OBS 等录到。黑洞主题为刷新桌面扭曲会默认排除录屏；录黑洞时请托盘勾选 **录屏可见**。

## 自定义主题

托盘 → **皮肤**：

1. **AI 设置（API Key）…** — 填写你自己的 Key（兼容 OpenAI 接口，可改 Base URL / 模型；可点「测试连接」）  
2. **从图片生成主题…** — 选一张参考图，由云端大模型真实生成桌宠皮肤并自动切换  
3. **导入主题包（.zip）…** — 导入现成主题包  

API Key 使用系统加密（Windows DPAPI / macOS Keychain）保存在 `ai-secrets.json`，不会明文写进 `config.json`，也不会随安装包分发。

用户主题目录：

- Windows：`%APPDATA%\black-hole-recycle-bin\themes\`
- macOS：`~/Library/Application Support/black-hole-recycle-bin/themes/`

## 更新记录

### v1.1.1
- 黑洞回收特效：松手放入后文件旋转撕碎吸入（悬停拖拽不再提前播放）
- 去掉吸入时的光粒子特效，改为纸质碎片撕碎
- 修复喂食变大时窗口先挪位再放大
- 迷你模式：不再「靠近边缘就吸附」，需拖出屏幕边缘足够距离才进入
- 修复迷你贴边后热区过小导致拖不动 / 退不出
- 变大动画锁定中心点，避免透明窗口位置跳动

### v1.1.0
- 录屏可见：小猫 / 炼丹 / 土星默认可被 EV、OBS 等录到
- 托盘新增「录屏可见」；黑洞主题录屏时勾选即可
- 修复桌宠状态被覆盖：打字 / 听歌 / 常态优先级正确恢复
- 修复三花小猫迷你素材在安装包中缺失

### v1.0.13
- 修复桌宠状态被覆盖：打字 / 听歌 / 常态优先级正确恢复
- 修复三花小猫迷你素材在安装包中缺失
- 打包保留迷你与打字动画；主题切换、勿扰、退出迷你后重同步表情

### v1.0.12
- 土星主题：行星自转（云带 / 风暴）与光环轻微漂移

### v1.0.11
- 清理临时素材；优化拖拽与靠边迷你进出

### v1.0.10
- 土星主题：回收站数量驱动光环碎石；喂食长大

### v1.0.9
- 炼丹少年主题；小猫吃文件 SVG；打字 / 听歌状态

## 开发运行

```bash
npm install
npm start
```

## 打包与发布更新

```bash
# 1) 改 package.json 的 version
# 2) 打 Windows 包（若 dist/win-unpacked 被占用，可打到 dist-release）
npm run build:win
# 或：
npx electron-builder --win nsis:x64 --config.directories.output=dist-release

# 3) 上传到 Gitee + GitHub 的 latest 发行版（覆盖旧附件）
npm run publish:gitee
npm run publish:github
# 或：npm run publish:all
```

产物在 `dist/`（或 `dist-release/`）：`BlackHoleRecycleBin-Windows-x64.exe`、`latest.yml`、`*.blockmap`（macOS 为 `BlackHoleRecycleBin-macOS-*.dmg`）。

也可在 GitHub Actions 手动运行 **Build** 工作流，自动打 Win/Mac 包并刷新 `latest` 发行版（永久直链会随之更新）。

### 测试自动更新

1. 先安装较旧版本（如 v1.0.13）
2. 确认 Gitee `latest` 发行版已是新版本（如 v1.1.0）的安装包与 `latest.yml`
3. 打开已安装应用 → 托盘 → **检查更新** → 下载 → 重启

| 平台 | 行为 |
|------|------|
| Windows 安装版 | 托盘「检查更新」→ 读 `latest.yml` → 下载 → 重启安装 |
| macOS 安装版 | 检查到新版本后打开 Gitee Releases 下载页 |
| 开发模式 `npm start` | 提示使用安装版检查更新 |

> 自动更新读取的是标签名为 **`latest`** 的发行版附件。
