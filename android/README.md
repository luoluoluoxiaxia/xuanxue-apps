# Android 客户端

原生 Android 工程使用 Kotlin 与 Jetpack Compose，只依赖仓库里的公共客户端契约和 `https://xx.zsien.tech` 公共 API。

客户端只提交用户操作并展示后端结果。账户、额度、排盘、任务状态以及 AI 实现选择均由后端决定；客户端不包含供应商、模型或提示词选择字段。

## 构建

```bash
cd android
./gradlew :app:assembleDebug
```

Debug 默认连接 Android 模拟器宿主机的 `http://10.0.2.2:8099/`；Release 固定连接正式 HTTPS 地址。会话令牌以 Android Keystore 中不可导出的 AES 密钥加密后落盘，应用清单关闭系统备份。

应用商店签名文件、服务账号和发布凭据不属于本仓库，必须放在受保护的 CI Environment 中。
