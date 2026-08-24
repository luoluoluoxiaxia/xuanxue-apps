package tech.zsien.xuanshu.data

import android.content.Context
import tech.zsien.xuanshu.BuildConfig
import tech.zsien.xuanshu.core.network.InterpretStream
import tech.zsien.xuanshu.core.network.XuanshuApi
import tech.zsien.xuanshu.core.network.XuanshuNetwork

/**
 * 手工依赖容器。
 *
 * 目前只有会话、API 与两个仓库，用 Hilt 反而是负担；等模块和 ViewModel 多起来
 * 再迁到 Hilt，届时这里的构造逻辑可以整段搬进 @Module。
 */
class AppContainer(context: Context) {

    val session: SessionManager = SessionManager(context.applicationContext)

    /** REST 与 SSE 共用同一个 client：连接池、拦截器、网络埋点因此保持统一。 */
    private val okHttpClient = XuanshuNetwork.okHttpClient { session.currentToken() }

    val api: XuanshuApi = XuanshuNetwork.api(BuildConfig.BASE_URL, okHttpClient)

    val accountRepository: AccountRepository = AccountRepository(api, session)

    val chartRepository: ChartRepository =
        ChartRepository(api, InterpretStream(okHttpClient, BuildConfig.BASE_URL))
}
