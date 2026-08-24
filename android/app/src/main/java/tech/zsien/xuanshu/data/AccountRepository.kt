package tech.zsien.xuanshu.data

import tech.zsien.xuanshu.core.network.XuanshuApi
import tech.zsien.xuanshu.core.network.apiCall
import tech.zsien.xuanshu.core.network.model.AccountResponse
import tech.zsien.xuanshu.core.network.model.LoginRequest
import tech.zsien.xuanshu.core.network.model.RegisterRequest

class AccountRepository(
    private val api: XuanshuApi,
    private val session: SessionManager,
) {

    suspend fun login(email: String, password: String): Result<AccountResponse> = apiCall {
        persist(api.login(LoginRequest(email = email, method = "password", password = password)))
    }

    /** 邮件通道不可用期间，用一次性邀请码注册。 */
    suspend fun registerWithInviteCode(email: String, password: String): Result<AccountResponse> = apiCall {
        val invite = api.inviteCode()
        persist(api.register(RegisterRequest(email = email, password = password, inviteCode = invite.code)))
    }

    suspend fun refresh(): Result<AccountResponse> = apiCall { api.me() }

    suspend fun logout(): Result<Unit> = apiCall {
        // 令牌可能已经失效，服务端拒绝也无所谓——本地会话必须清干净。
        runCatching { api.logout() }
        session.clear()
    }

    private suspend fun persist(response: AccountResponse): AccountResponse {
        if (response.sessionToken.isNotBlank()) {
            session.save(response.sessionToken)
        }
        return response
    }
}
