package tech.zsien.xuanshu.core.network

import okhttp3.Interceptor
import okhttp3.Response

/**
 * 按公开客户端协议附带客户端标识、交互标记与可选会话令牌。
 * 协议标记不构成身份认证；受保护接口仍以会话令牌为准。
 */
class SessionInterceptor(
    private val tokenProvider: () -> String?,
    private val clientId: String = CLIENT_ID_ANDROID,
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val builder = chain.request().newBuilder()
            .header(HEADER_CLIENT, clientId)
            .header(HEADER_INTERACTION, INTERACTION_VALUE)
        tokenProvider()?.takeIf { it.isNotBlank() }?.let { token ->
            builder.header(HEADER_AUTHORIZATION, "Bearer $token")
        }
        return chain.proceed(builder.build())
    }

    companion object {
        const val HEADER_CLIENT = "X-Xuanshu-Client"
        const val HEADER_AUTHORIZATION = "Authorization"
        const val HEADER_INTERACTION = "X-Xuanshu-Interaction"
        const val INTERACTION_VALUE = "same-origin-v1"
        const val CLIENT_ID_ANDROID = "android"
    }
}
