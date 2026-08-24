# 参与开发

## 开始前

```bash
npm run check
npm run package:web
cd android && ./gradlew :app:assembleDebug
```

客户端只能使用 `contracts/openapi/client.openapi.json` 和 `contracts/events/`。缺少接口时，应先在私有后端更新并发布公共契约，不要在客户端猜测字段或复制后端业务规则。

所有变更通过 Pull Request 合并到 `main`。合并前必须通过 Web、Android 检查并获得代码所有者审核；禁止直接推送、强制推送或删除 `main`。

`main` 合并后，私有核心仓库会在约 5 分钟内发现新提交，重新执行客户端边界、契约与 Web 联调门禁。验证通过后只自动发布 Web 静态包；Android 仍只在本仓库构建，不会部署到服务器。公开契约与私有源不一致时自动同步会停止，等待后端维护者处理。

提交前请确认：

- 没有 `.env`、`local.properties`、签名文件、令牌、Webhook 或真实用户数据；
- Web 的加载、错误、断线恢复和移动宽度行为没有退化；
- Android Debug 构建通过；
- `npm run check:boundary` 通过。
