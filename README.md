# 黑洞回收站 · Black Hole Recycle Bin

Interstellar 风格桌面黑洞回收站（Electron）：Windows / macOS。把文件拖进去送入系统回收站。

仓库：[gitee.com/dong-tianyi-11/black-hole-recycle-bin](https://gitee.com/dong-tianyi-11/black-hole-recycle-bin)

内置皮肤：**黑洞**、**三花小猫**。支持自定义主题与 **Gitee 自动更新**。

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
