# 玄枢客户端

这是玄枢公开客户端仓库，只包含面向用户的客户端、公开协议、合成示例和客户端构建工具。私有后端、命理核心、管理后台、AI 实现、评测、生产配置和部署凭据不在这里。

## 目录

```text
web/                       生产 Web 客户端
android/                   原生 Android 客户端
contracts/openapi/         公共 REST 契约
contracts/events/          SSE 事件契约
contracts/examples/        合成任务示例
scripts/                   客户端检查与 Web 打包
```

iOS 与鸿蒙工程会在技术路线和真机原型通过后创建。

## 客户端边界

客户端是展示与交互层：提交用户操作，展示账户、额度、命盘、卦象、任务状态和产品内容。供应商、模型、提示词版本、路由、raw reasoning、usage、成本以及权限决策只存在于私有后端。

唯一机器契约是 `contracts/openapi/client.openapi.json` 与 `contracts/events/`。公开契约由私有后端生成、校验后同步到本仓库。

## 本地验证

```bash
npm ci
npm run check
npm run package:web

cd android
./gradlew :app:assembleDebug
```

Web 发布物会生成到 `dist/web/xuanxue-web.tar.gz`。公开仓库 CI 只构建和归档客户端产物，不持有服务器 SSH 或生产部署凭据；正式部署由私有后端仓库按固定提交和摘要执行。

## 许可证

第一方源码公开可见但保留全部权利，详见 `LICENSE`。第三方组件使用各自许可证，详见 `THIRD_PARTY_NOTICES.md` 及组件旁的许可证文件。
