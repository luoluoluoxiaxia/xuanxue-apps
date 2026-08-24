# Android 客户端规则

- 只依赖 `../contracts/` 与公开 HTTPS API，不导入私有后端或复制命理规则。
- 不提交或发送供应商、模型、提示词版本、路由、raw reasoning、usage 或成本字段。
- 会话令牌必须由 Android Keystore 保护，禁止写入普通 DataStore、明文 SharedPreferences、日志或源码。
- Debug 可以访问模拟器宿主地址；Release 只访问 `https://xx.zsien.tech/`。
- 每次修改至少运行 `./gradlew :app:assembleDebug`；认证、长任务或排盘改动还需要真机验证。
- Android 构建物不进入 Web 静态包，也不由生产服务器部署流程上传。
