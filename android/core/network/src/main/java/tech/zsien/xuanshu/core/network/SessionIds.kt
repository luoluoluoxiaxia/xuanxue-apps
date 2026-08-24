package tech.zsien.xuanshu.core.network

import java.security.SecureRandom

/**
 * 会话 ID：同一个命盘下的连续追问共用一个，服务端据此把问答串成一段对话并留档。
 *
 * 公开协议格式为 `s_` 加 8 个随机字节的十六进制表示，共 16 个 hex 字符。
 */
fun newSessionId(): String {
    val bytes = ByteArray(8)
    SecureRandom().nextBytes(bytes)
    return "s_" + bytes.joinToString("") { "%02x".format(it) }
}
