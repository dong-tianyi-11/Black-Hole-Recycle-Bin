# 黑洞回收站 · Black Hole Recycle Bin

Interstellar 风格桌面黑洞回收站（Electron）：Windows / macOS。把文件拖进去送入系统回收站。

仓库：[gitee.com/dong-tianyi-11/black-hole-recycle-bin](https://gitee.com/dong-tianyi-11/black-hole-recycle-bin)

内置皮肤：**黑洞**、**三花小猫**。支持自定义主题与 **Gitee 自动更新**。

## 开发运行

```bash
npm install
npm start
```

## 打包桌面应用

```bash
# Windows 安装包 (NSIS)
npm run build:win

# macOS DMG（需在 macOS 上构建）
npm run build:mac
```

产物在 `dist/`：

| 平台 | 文件 |
|------|------|
| Windows | `BlackHoleRecycleBin-Setup-*.exe` + `latest.yml` + `*.blockmap` |
| macOS | `BlackHoleRecycleBin-*.dmg` + `latest-mac.yml` |

macOS 未签名时，首次打开请右键 → 打开，或执行：

```bash
xattr -cr "/Applications/黑洞回收站.app"
```

## 自动更新（Gitee）

更新源已指向 Gitee Releases 的固定标签 **`latest`**：

`https://gitee.com/dong-tianyi-11/black-hole-recycle-bin/releases/download/latest/`

| 平台 | 行为 |
|------|------|
| Windows 安装版 | 托盘「检查更新」→ 读 `latest.yml` → 下载 → 重启安装 |
| macOS 安装版 | 检查到新版本后打开 Gitee Releases 下载页 |
| 开发模式 `npm start` | 提示使用安装版检查更新 |

托盘还可开关 **自动检查更新**（后台约每 12 小时）。

### 发版流程（必须）

1. 改 `package.json` 的 `version`（如 `1.0.1`）
2. 本地打包：`npm run build:win`
3. 在 Gitee 仓库 → **发行版** → 创建/编辑标签为 **`latest`** 的发行版  
   - 标题建议写版本号，如 `v1.0.1`
4. 上传 `dist/` 中这些文件到该发行版（覆盖旧文件）：
   - `latest.yml`
   - `BlackHoleRecycleBin-Setup-*.exe`
   - 对应的 `*.blockmap`（若有）
5. （可选）再另建标签 `v1.0.1` 作历史存档

> 注意：自动更新读取的是标签名为 **`latest`** 的发行版附件，不是随便一个 `v*` 标签。

## 操作

| 操作 | 效果 |
|------|------|
| 左键拖拽 | 移动 |
| 左键单击 | 小猫戳一戳 / 唤醒 |
| 滚轮 | 放大 / 缩小 |
| 拖入文件 | 吸入 / 吃掉 → 回收站（Win / Mac） |
| 托盘 | 皮肤、勿扰、多屏、开机启动、检查更新等 |

## 自定义主题

托盘 → **皮肤** → 导入 zip / 从模板新建 / 打开主题文件夹。

用户目录：

- Windows：`%APPDATA%\black-hole-recycle-bin\themes\`
- macOS：`~/Library/Application Support/black-hole-recycle-bin/themes/`
