# 第三方组件

Web 发布物包含以下第三方组件或数据：

- Apache ECharts 6.1.0：Apache-2.0；其内嵌 d3.js 子组件采用 BSD-3-Clause。许可证与 NOTICE 位于 `web/public/vendor/`。
- qrcode-generator 2.0.4：MIT，许可证位于 `web/public/vendor/`。
- opencc-js 1.4.2 的 TSCharacters 字形词典：代码为 MIT，派生自 Apache-2.0 的 opencc-data；许可证与来源说明位于 `web/public/vendor/`。仅用于书名与目录的简繁搜索比较，不转换底本文字。
- china-map-geojson 1.0.4：ISC，许可证位于 `web/public/maps/`。
- Administrative-divisions-of-China 行政区划数据：WTFPL-2.0，许可证位于 `web/public/vendor/licenses/`。
- Gradle Wrapper 9.7.1：Apache-2.0，许可证随 `android/gradle/wrapper/gradle-wrapper.jar` 的 `META-INF/LICENSE` 分发。

Android 依赖由 Gradle 版本目录声明，发布时应由应用商店构建流程生成依赖许可证清单。
