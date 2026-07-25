# 黑洞回收站 · Black Hole Recycle Bin

Interstellar 风格桌面黑洞回收站（Electron）：Windows / macOS。把文件拖进去送入系统回收站。

仓库：
- Gitee（发行版 / 自动更新）：[gitee.com/dong-tianyi-11/black-hole-recycle-bin](https://gitee.com/dong-tianyi-11/black-hole-recycle-bin)
- GitHub：[github.com/dong-tianyi-11/Black-Hole-Recycle-Bin](https://github.com/dong-tianyi-11/Black-Hole-Recycle-Bin)

内置皮肤：**黑洞**、**三花小猫**、**炼丹少年**。支持自定义主题与 **Gitee 自动更新**。

## 系统要求

| 平台 | 最低版本 | 说明 |
|------|----------|------|
| Windows | **Windows 10** x64（及更高） | 受 Chromium/Electron 限制，无法再支持 Win7/8/8.1 |
| macOS | **11 Big Sur** 及以上 | 同时提供 Intel (x64) 与 Apple Silicon (arm64) 安装包 |

配置与 API Key 存放在用户目录（`%APPDATA%\black-hole-recycle-bin` / `~/Library/Application Support/black-hole-recycle-bin`），**更新安装不会清除**。

## 开发运行

```bash
npm install
npm start
```

## 打包与发布更新

```bash
# 1) 改 package.json 的 version
# 2) 打 Windows 包
npm run build:win

# 3) 上传到 Gitee 发行版标签 latest（覆盖旧附件）
npm run publish:gitee
```

产物在 `dist/`：`BlackHoleRecycleBin-Setup-*.exe`、`latest.yml`、`*.blockmap`。

### 测试自动更新

1. 先安装较旧版本（如 v1.0.0）
2. 确认 Gitee `latest` 发行版已是新版本（如 v1.0.1）的安装包与 `latest.yml`
3. 打开已安装应用 → 托盘 → **检查更新** → 下载 → 重启

| 平台 | 行为 |
|------|------|
| Windows 安装版 | 托盘「检查更新」→ 读 `latest.yml` → 下载 → 重启安装 |
| macOS 安装版 | 检查到新版本后打开 Gitee Releases 下载页 |
| 开发模式 `npm start` | 提示使用安装版检查更新 |

> 自动更新读取的是标签名为 **`latest`** 的发行版附件。

## 操作

| 操作 | 效果 |
|------|------|
| 左键拖拽 | 移动；拖到左右屏幕边缘松手进入迷你模式 |
| 迷你模式 | 半身藏进边框；悬停探头；单击退出 |
| 左键单击 | 小猫戳一戳 / 唤醒（迷你模式下为退出迷你） |
| 滚轮 | 放大 / 缩小 |
| 拖入文件 | 吸入 / 吃掉 → 回收站（Win / Mac） |
| 托盘 | 皮肤、勿扰、多屏、开机启动、检查更新等 |

## 自定义主题

托盘 → **皮肤**：

1. **AI 设置（API Key）…** — 填写你自己的 Key（兼容 OpenAI 接口，可改 Base URL / 模型；可点「测试连接」）  
2. **从图片生成主题…** — 选一张参考图，由云端大模型真实生成桌宠皮肤并自动切换  
3. **导入主题包（.zip）…** — 导入现成主题包  

API Key 使用系统加密（Windows DPAPI / macOS Keychain）保存在 `ai-secrets.json`，不会明文写进 `config.json`，也不会随安装包分发。

用户主题目录：

- Windows：`%APPDATA%\black-hole-recycle-bin\themes\`
- macOS：`~/Library/Application Support/black-hole-recycle-bin/themes/`
