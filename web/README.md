# Web 客户端

`public/` 是当前生产 Web 的唯一源码和零转换发布目录。本地源码运行时，FastAPI 可以直接挂载这里；生产环境把它打成独立静态包，由 Nginx 提供，不进入后端 wheel。

## 运行时结构

`index.html` 是唯一的页面入口，也是搜索引擎收录的规范页面。它只负责 SEO 元数据、首帧前确定浅色 / 深色和启动占位，界面全部由 `next/` 下的浏览器原生 ES 模块渲染，不需要 Node 打包或框架运行时：

```text
index.html            SEO 元数据、首帧前的外观选择、样式与入口
  ↓
chat-render.js        回答正文渲染（与后端帖子页共用）
next/app.js           外壳、导航、会话与路由装配
  ├─ lib/             请求（CSRF、同域互动证明）、哈希路由、会话与草稿、解读任务引擎、文案、旧地址映射
  ├─ ui/              浮层、提示、卦象、命盘与卦盘面板、说明浮层、出生地选择、分享卡片
  └─ views/           每个页面一个模块：广场、帖子、提问、解读、今日、消息、我的、登录、反馈
```

- 所有相对导入都带同一个版本号（当前 `?v=n5`，与 `index.html` 中的入口脚本和样式表一致），发布新版本时统一替换。`scripts/build-web.mjs` 检查版本一致性和导入目标是否存在，防止同一模块被加载两份或缺模块导致整页打不开。
- 路由使用哈希，静态托管无需改写：`#/` 首页（写下问题、选六爻或八字；旧的 `#/ask` 会跳到这里）、`#/ask/liuyao`、`#/ask/bazi` 起卦与排盘、`#/square` 广场、`#/post/<slug>` 帖子讨论、`#/reading/<档案 id>[?session=]` 解读工作台、`#/today` 今日、`#/inbox` 消息、`#/me`（`/archives`、`/credits`、`/settings`）。
- 导航：桌面顶栏「问 · 广场 · 今日 · 我的盘」；手机底栏「问 · 广场 · 今日 · 我」，消息收在「我」里（未读数挂在「我」上），手机顶栏不再放铃铛。
- 旧版首页的地址在启动时映射过来（`next/lib/legacy.js`）：`?post=<slug>[&target=comment-<id>]`、`?start=liuyao|bazi[&community=help][&set_default=1]`、`?view=credits|archives`（含支付返回参数和 `month`）、`#gua-square`（广场）。
- 外观默认浅色（红白）；顶栏的开关一键切换深色，设置里还可以选「跟随系统」（`localStorage.xz-next-theme`：`light` / `dark` / `auto`，未设置时按 `light`）。
- `regions.js`（行政区划）和 `share-card.js`（分享长图）按需加载。

## 与后端页面共用的资源

下面这些文件不属于首页，但后端页面仍直接引用，前端改版时不能删除：

- 解读正文渲染：`chat-render.js`（新版解读页与管理后台会话共用）。
- 岁运全书旧报告页（`/forecast/view/<id>`，计划 2026-12-31 后下线）：`forecast-view.html`、`forecast.css`、`style.css`。
- 管理后台地图：`admin-ip-geo-map.js`、`maps/`、`vendor/`。

后端渲染的帖子完整页已经下线（`/gua/<slug>` 返回 404），旧版 `account`、`community` 脚本与样式随之删除；帖子页不再展示指向完整页的「更多」菜单。举报与「发布事情进展」需要先在公开契约里补上两个表单的可选值，再在新版帖子页内完成。

## 检查与打包

从仓库根目录运行：

```bash
npm run build:web
npm run package:web
```

`build:web` 验证页面资产、脚本语法、模块版本与导入、搜索元数据和公开安全边界（互动证明、登录注册边界、不写 Cookie、不暴露隐藏入口），不重写源码；旧版首页的文件如果被合并带回来也会报错。私有后端仓库另行验证服务端模板联动。`package:web` 生成只含静态文件的确定性 `dist/web/xuanxue-web.tar.gz`。

八字命盘中的五行、十神、逐年干支和趋势展示分值由后端统一投影；Web 只消费 `stem_element`、`branch_element`、`stem_ten_god`、`display_years` 和 `display_trend_score`，不得在客户端重新实现这些业务规则。颜色、排版和静态名词解释仍属于前端展示职责。

六爻本机摇钱只负责生成并展示用户操作得到的六个爻值；本卦、变卦、世应、六亲等机械事实统一由后端返回，Web 不保留六十四卦计算表或本地装卦实现。

客户端只依赖 `contracts/openapi/client.openapi.json` 和 `contracts/events/`。它展示后端给出的产品结果，不选择或接收模型、供应商、提示词版本、路由策略、原始推理、用量或成本。
