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
    @SerialName("credit_wallet") val creditWallet: CreditWallet? = null,
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
data class CreditWallet(
    val balance: Int = 0,
    @SerialName("welcome_credits") val welcomeCredits: Int = 0,
    @SerialName("available_credits") val availableCredits: Int = 0,
)

@Serializable
data class CreditActivitySummary(
    @SerialName("account_balance") val accountBalance: Int = 0,
    @SerialName("lifetime_credited") val lifetimeCredited: Int = 0,
    @SerialName("lifetime_spent") val lifetimeSpent: Int = 0,
    @SerialName("answer_count") val answerCount: Int = 0,
    @SerialName("required_credits") val requiredCredits: Int = 0,
    @SerialName("daily_free_spent") val dailyFreeSpent: Int = 0,
    @SerialName("account_spent") val accountSpent: Int = 0,
    @SerialName("platform_covered") val platformCovered: Int = 0,
)

@Serializable
data class PageInfo(
    val page: Int = 1,
    @SerialName("page_size") val pageSize: Int = 20,
    @SerialName("page_count") val pageCount: Int = 1,
    val total: Int = 0,
)

@Serializable
data class CreditActivityItem(
    val id: String = "",
    val direction: String = "",
    val category: String = "",
    @SerialName("entry_type") val entryType: String = "",
    val title: String = "",
    val description: String = "",
    val amount: Int = 0,
    @SerialName("required_credits") val requiredCredits: Int = 0,
    @SerialName("daily_free_spent") val dailyFreeSpent: Int = 0,
    @SerialName("paid_spent") val paidSpent: Int = 0,
    @SerialName("platform_covered") val platformCovered: Int = 0,
    @SerialName("balance_after") val balanceAfter: Int = 0,
    @SerialName("daily_remaining") val dailyRemaining: Int? = null,
    @SerialName("created_at") val createdAt: String = "",
)

@Serializable
data class CreditActivityPage(
    val wallet: CreditWallet = CreditWallet(),
    val summary: CreditActivitySummary = CreditActivitySummary(),
    val items: List<CreditActivityItem> = emptyList(),
    val kind: String = "all",
    val pagination: PageInfo = PageInfo(),
)

@Serializable
data class PaymentOrderItem(
    @SerialName("order_id") val orderId: String = "",
    val currency: String = "usd",
    @SerialName("amount_total") val amountTotal: Int = 0,
    val credits: Int = 0,
    val status: String = "pending",
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("paid_at") val paidAt: String? = null,
    @SerialName("expired_at") val expiredAt: String? = null,
)

@Serializable
data class PaymentOrderPage(
    val items: List<PaymentOrderItem> = emptyList(),
    val status: String = "all",
    val pagination: PageInfo = PageInfo(),
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
data class VerificationCodeResponse(
    val ok: Boolean = false,
    val message: String = "",
    @SerialName("expires_in") val expiresIn: Int = 0,
    @SerialName("retry_after") val retryAfter: Int = 0,
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
