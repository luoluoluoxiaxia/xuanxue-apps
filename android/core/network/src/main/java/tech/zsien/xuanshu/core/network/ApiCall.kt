package tech.zsien.xuanshu.core.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.SerializationException
import retrofit2.HttpException
import java.io.IOException

/**
 * 网络层抛出的统一异常。
 *
 * Retrofit 的 [HttpException] 不越过本模块边界——上层只认这个类型，
 * 因此 retrofit 可以保持 implementation 依赖，替换网络库时不会波及业务代码。
 */
class ApiException(
    override val message: String,
    val statusCode: Int,
) : Exception(message)

/** 客户端与服务端契约不兼容，本地无法解析响应。 */
const val STATUS_INCOMPATIBLE = -2

/** HTTP 401：令牌失效或未登录，调用方通常需要清理本地会话。 */
val ApiException.isUnauthorized: Boolean get() = statusCode == 401

/**
 * 统一切到 IO 线程执行，并把 HTTP / IO / 反序列化故障翻译成 [ApiException]。
 *
 * 反序列化失败必须捕获：服务端字段类型一旦变化（例如某字段从字符串变成对象），
 * 未捕获的 SerializationException 会直接让 App 闪退。宁可给用户一句「请更新版本」，
 * 也不能白屏退出——这也正是 /api/app/version 强更闸门要解决的场景。
 */
suspend fun <T> apiCall(block: suspend () -> T): Result<T> = withContext(Dispatchers.IO) {
    try {
        Result.success(block())
    } catch (e: HttpException) {
        Result.failure(ApiException(e.detailMessage(), e.code()))
    } catch (e: IOException) {
        Result.failure(ApiException("网络不可用，请检查连接后重试", 0))
    } catch (e: SerializationException) {
        Result.failure(ApiException("数据格式已更新，请升级到最新版本", STATUS_INCOMPATIBLE))
    }
}

/**
 * 后端业务错误是 `{"detail": "文案"}`，但 FastAPI 的 422 参数校验错误里
 * `detail` 是一个数组（每项含 loc/msg/type）。两种形状都要能读，否则校验失败
 * 会被吞成一句无用的「请求失败」，排查时完全看不到是哪个字段出了问题。
 */
private fun HttpException.detailMessage(): String {
    val raw = runCatching { response()?.errorBody()?.string() }.getOrNull().orEmpty()
    val detail = runCatching {
        XuanshuNetwork.json.parseToJsonElement(raw).jsonObject["detail"]
    }.getOrNull()

    val message = when (detail) {
        is JsonPrimitive -> detail.content
        is JsonArray -> detail.mapNotNull { item ->
            val obj = item as? JsonObject ?: return@mapNotNull null
            val field = (obj["loc"] as? JsonArray)?.lastOrNull()?.jsonPrimitive?.content
            val msg = obj["msg"]?.jsonPrimitive?.content
            listOfNotNull(field, msg).joinToString(" ")
        }.joinToString("；").ifBlank { null }
        else -> null
    }
    return message?.takeIf { it.isNotBlank() } ?: "请求失败（HTTP ${code()}）"
}
