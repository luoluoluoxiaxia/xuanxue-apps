# Web 客户端

`public/` 是当前生产 Web 的唯一源码和零转换发布目录。本地源码运行时，FastAPI 可以直接挂载这里；生产环境把它打成独立静态包，由 Nginx 提供，不进入后端 wheel。

## 运行时结构

Web 仍使用浏览器原生脚本，不需要 Node 打包或框架运行时。`index.html` 按职责加载：

```text
基础独立脚本（账户、个人主页、Markdown、分享）
  ↓
modules/core.js、chat-copy.js、chart-domain.js
modules/location-picker.js、modal-manager.js、home-community.js
  ↓
app.js                         页面状态、命盘/起卦工作区与导航编排
  ↓
modules/profile-workspace.js  档案与历史工作区
modules/chat-workspace.js     解读任务、流式回答、恢复与消息反馈
  ↓
app-bootstrap.js              所有模块就绪后唯一调用 init()
```

`core.js` 等前置模块通过只读的 `window.Xuanxue*` 命名空间提供窄能力；`profile-workspace.js` 和 `chat-workspace.js` 是现有零构建应用的后置功能片段，明确共享 `app.js` 的页面运行时，只能按 `index.html` 中的顺序加载，不能单独执行。这个兼容层避免在目录重构时同时改写页面交互，后续若迁移 TypeScript 或组件框架，再由显式 import 替换。

新增独立功能优先进入 `public/modules/<responsibility>.js`；`app.js` 只保留跨功能页面状态、排盘/起卦主流程和装配。架构测试将 `app.js` 限制在 4000 行以内，防止功能重新回流到单一入口。

从仓库根目录运行：

```bash
npm run build:web
npm run package:web
```

`build:web` 验证页面资产、脚本语法、加载顺序和公开安全边界，不重写源码。私有后端仓库另行验证服务端模板联动。`package:web` 生成只含静态文件的确定性 `dist/web/xuanxue-web.tar.gz`。后续把分散的直接 `fetch` 收敛为契约客户端，再根据行为回归结果决定是否引入 TypeScript 或组件框架。

八字命盘中的五行、十神、逐年干支和趋势展示分值由后端统一投影；Web 只消费 `stem_element`、`branch_element`、`stem_ten_god`、`display_years` 和 `display_trend_score`，不得在客户端重新实现这些业务规则。颜色、排版和静态名词解释仍属于前端展示职责。

六爻本机摇钱只负责生成并展示用户操作得到的六个爻值；本卦、变卦、世应、六亲等机械事实统一由后端返回，Web 不保留六十四卦计算表或本地装卦实现。

客户端只依赖 `contracts/openapi/client.openapi.json` 和 `contracts/events/`。它展示后端给出的产品结果，不选择或接收模型、供应商、提示词版本、路由策略、原始推理、用量或成本。
