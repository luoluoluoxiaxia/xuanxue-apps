package tech.zsien.xuanshu.core.network.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * 公开账户响应。
 *
 * [sessionToken] 是原生客户端的敏感会话凭证，必须用 Android Keystore 保护落盘密文，
 * 并且只发送给受信任的正式服务地址。
 */
@Serializable
data class AccountResponse(
    val authenticated: Boolean = false,
    val user: AccountUser? = null,
    @SerialName("csrf_token") val csrfToken: String = "",
    @SerialName("private_quota") val privateQuota: PrivateQuota? = null,
    @SerialName("session_token") val sessionToken: String = "",
    @SerialName("session_expires_in") val sessionExpiresIn: Long = 0L,
)

@Serializable
data class AccountUser(
    val id: String = "",
    val email: String = "",
    @SerialName("current_city") val currentCity: String = "",
    @SerialName("created_at") val createdAt: String = "",
)

/** 私密提问的每日额度，按北京时间计算。 */
@Serializable
data class PrivateQuota(
    val date: String = "",
    val base: Int = 0,
    @SerialName("referral_bonus") val referralBonus: Int = 0,
    val total: Int = 0,
    val used: Int = 0,
    val reserved: Int = 0,
    val remaining: Int = 0,
    @SerialName("max_total") val maxTotal: Int = 0,
    @SerialName("pending_referrals") val pendingReferrals: Int = 0,
    @SerialName("qualified_referrals") val qualifiedReferrals: Int = 0,
)

@Serializable
data class LoginRequest(
    val email: String,
    val method: String = "password",
    val password: String? = null,
    val code: String? = null,
)

@Serializable
data class VerificationCodeRequest(
    val email: String,
    /** register 或 login。 */
    val purpose: String,
)

@Serializable
data class RegisterRequest(
    val email: String,
    val password: String,
    val code: String? = null,
    @SerialName("invite_code") val inviteCode: String? = null,
)

/** 注册资格凭证：仍须同时验证邮箱，一次性邀请码在成功注册后失效。 */
@Serializable
data class InviteCodeResponse(
    val code: String = "",
    val remaining: Int = 0,
)

@Serializable
data class OkResponse(val ok: Boolean = false)
