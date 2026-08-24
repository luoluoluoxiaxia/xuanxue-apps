package tech.zsien.xuanshu.core.network

import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

/**
 * 构造与后端通信所需的 OkHttp / Retrofit。
 *
 * SSE 之后会复用这里的同一个 [OkHttpClient]，让连接池、拦截器与网络埋点保持统一；
 * 因此读超时不能设得太短——解读任务的流式响应要跑 70~95 秒。
 */
object XuanshuNetwork {

    val json: Json = Json {
        /** 服务端返回的字段远多于客户端要用的，未知字段一律忽略而不是报错。 */
        ignoreUnknownKeys = true
        /** null 不进请求体，让服务端用它自己的默认值。 */
        explicitNulls = false
        /**
         * 必须开启：kotlinx.serialization 默认**不序列化等于默认值的属性**，
         * 而后端用 Pydantic 校验必填字段——例如 scenario 恰好等于默认值 "natal"
         * 时会被整个省略，服务端直接回 422 "Field required"。
         */
        encodeDefaults = true
    }

    fun okHttpClient(tokenProvider: () -> String?): OkHttpClient =
        OkHttpClient.Builder()
            .addInterceptor(SessionInterceptor(tokenProvider))
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .build()

    fun api(baseUrl: String, client: OkHttpClient): XuanshuApi =
        Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(XuanshuApi::class.java)
}
