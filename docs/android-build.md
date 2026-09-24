# Android 构建说明

应用名称：**星环守卫**。包名：`io.starring.guardian`。版本：`1.0.0` / `versionCode 1`。支持 Android 8.0（API 26）及以上，竖屏运行。

APK 使用系统 Android WebView 运行内置的 HTML、Canvas、CSS 和 JavaScript。全部游戏资源随 APK 打包；无需服务器、账号或网络。Manifest 不申请任何权限，也不包含广告、充值、分析 SDK 或第三方运行时依赖。

## 准备工具

需要 Windows、PowerShell、JDK 17，以及 Google Android SDK 的以下组件：

- Android SDK Build-Tools `35.0.0`
- Android SDK Platform `35`（包含 `android.jar`）

可以使用现有安装，也可以运行以下脚本下载微软官方 JDK 和 Google 官方 SDK，并整理到本项目目录。首次下载约 300 MB，不需要安装 Gradle 或 Android Studio：

```powershell
powershell -ExecutionPolicy Bypass -File tools/provision-android.ps1
```

脚本自动生成的目录结构：

```text
.build-deps/
  jdk/bin/java.exe
  jdk/bin/javac.exe
  android-sdk/build-tools/35.0.0/aapt2.exe
  android-sdk/build-tools/35.0.0/lib/d8.jar
  android-sdk/platforms/android-35/android.jar
```

工具下载来自 [OpenJDK](https://jdk.java.net/archive/) 或其他官方 JDK 发行渠道，以及 [Google Android SDK](https://developer.android.com/studio)。遵守各工具自己的许可证。工具文件不属于本游戏源码，未提交至仓库。

## 构建

在项目目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File tools/build-apk.ps1
```

也可指定现有工具的位置：

```powershell
pwsh -File tools/build-apk.ps1 -JavaHome 'C:\tools\jdk-17' -AndroidSdk 'C:\tools\android-sdk'
```

脚本依次编译资源、打包 `web/`、编译 Java 容器、转换 DEX、对齐和签名，最后验证签名、资源和权限。输出：

- `output/orbit-guard-v1.0.0.apk`：可侧载安装的 APK。
- `output/orbit-guard-v1.0.0.apk.sha256`：SHA-256 校验值。
- `output/build-info.json`：包信息、文件大小、校验值和构建时间。

## 签名与更新

提供的 APK 使用**本地开发签名**，适合直接安装和个人体验；不是 Google Play 商店发行包。首次构建会创建 `.build/signing/development.jks`，之后复用该密钥。开发签名采用常规公开开发密码，不用于正式商业发布。

签名密钥、SDK、JDK、APK 产物和缓存均在 `.gitignore` 中排除。重新构建时请保留本地签名密钥：同包名、同签名的更新可保留现有进度；更换签名后，系统通常要求卸载旧版本再安装，卸载会删除存档。

## 容器行为

- 仅允许加载 APK 内的 `android_asset` 资源；禁止外部网页、网络请求、内容提供器和任意本地文件访问。
- `AndroidStore.load()` / `AndroidStore.save(json)` 使用应用私有 SharedPreferences 保存一个有大小限制的 JSON 存档，网页同时保留 localStorage 回退。
- 切到后台调用 `window.gameApp.onBackground()` 保存并暂停；返回调用 `onForeground()`。
- Android 返回键调用 `window.gameApp.onBack()`：关闭金币修改器或暂停战斗。
- 保留深色状态栏和导航栏；Android 11 及以上显式处理状态栏、屏幕缺口及键盘内边距，避免金币输入框被系统区域遮挡。
- 不申请存储权限，不导入导出用户文件，不读取设备标识，不使用后台服务。

## 验证范围

构建脚本自动检查 ZIP 对齐、APK 签名、包名与版本输出、零权限，以及四个游戏资源文件和 DEX 的存在。游戏逻辑和浏览器交互检查见项目 README。构建检查本身不等同于 Android 真机运行测试。
