# 参与开发

## 开始前

```bash
npm run check
npm run package:web
cd android && ./gradlew :app:assembleDebug
```

客户端只能使用 `contracts/openapi/client.openapi.json` 和 `contracts/events/`。缺少接口时，应先在私有后端更新并发布公共契约，不要在客户端猜测字段或复制后端业务规则。

提交前请确认：

- 没有 `.env`、`local.properties`、签名文件、令牌、Webhook 或真实用户数据；
- Web 的加载、错误、断线恢复和移动宽度行为没有退化；
- Android Debug 构建通过；
- `npm run check:boundary` 通过。
