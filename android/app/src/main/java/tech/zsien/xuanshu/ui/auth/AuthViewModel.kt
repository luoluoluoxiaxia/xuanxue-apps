package tech.zsien.xuanshu.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import tech.zsien.xuanshu.XuanshuApplication
import tech.zsien.xuanshu.core.network.model.AccountResponse
import tech.zsien.xuanshu.core.network.model.AccountUser
import tech.zsien.xuanshu.core.network.model.CreditWallet
import tech.zsien.xuanshu.core.network.model.PrivateQuota
import tech.zsien.xuanshu.data.AccountRepository
import tech.zsien.xuanshu.data.SessionManager

data class AuthUiState(
    /** 启动时先恢复本地令牌，恢复完成前不该闪一下登录页。 */
    val restoring: Boolean = true,
    val submitting: Boolean = false,
    val sendingCode: Boolean = false,
    val verificationCodeSent: Boolean = false,
    val verificationCodePurpose: String? = null,
    val verificationCodeEmail: String? = null,
    val verificationCodeRetryAfter: Int = 0,
    val user: AccountUser? = null,
    val quota: PrivateQuota? = null,
    val wallet: CreditWallet? = null,
    val error: String? = null,
) {
    val loggedIn: Boolean get() = user != null
}

class AuthViewModel(
    private val repository: AccountRepository,
    private val session: SessionManager,
) : ViewModel() {

    private val _state = MutableStateFlow(AuthUiState())
    val state: StateFlow<AuthUiState> = _state.asStateFlow()
    private var verificationCooldownJob: Job? = null

    init {
        viewModelScope.launch {
            session.restore()
            if (session.isLoggedIn()) {
                // 本地有令牌不等于仍然有效：可能已过期或被服务端吊销，必须回查一次。
                repository.refresh()
                    .onSuccess(::applyAccount)
                    .onFailure { session.clear() }
            }
            _state.update { it.copy(restoring = false) }
        }
    }

    fun login(email: String, password: String) {
        submit { repository.login(email.trim(), password) }
    }

    fun loginWithCode(email: String, code: String) {
        submit { repository.loginWithCode(email.trim(), code.trim()) }
    }

    fun sendVerificationCode(email: String, purpose: String) {
        val normalizedEmail = email.trim().lowercase()
        verificationCooldownJob?.cancel()
        _state.update {
            it.copy(
                sendingCode = true,
                verificationCodeSent = false,
                verificationCodePurpose = null,
                verificationCodeEmail = null,
                verificationCodeRetryAfter = 0,
                error = null,
            )
        }
        viewModelScope.launch {
            repository.requestVerificationCode(normalizedEmail, purpose)
                .onSuccess { response ->
                    val retryAfter = response.retryAfter.coerceIn(0, 3_600)
                    _state.update {
                        it.copy(
                            sendingCode = false,
                            verificationCodeSent = true,
                            verificationCodePurpose = purpose,
                            verificationCodeEmail = normalizedEmail,
                            verificationCodeRetryAfter = retryAfter,
                            error = null,
                        )
                    }
                    if (retryAfter > 0) {
                        verificationCooldownJob = viewModelScope.launch {
                            repeat(retryAfter) {
                                delay(1_000)
                                _state.update { current ->
                                    if (
                                        current.verificationCodePurpose == purpose &&
                                        current.verificationCodeEmail == normalizedEmail
                                    ) {
                                        current.copy(
                                            verificationCodeRetryAfter =
                                                (current.verificationCodeRetryAfter - 1)
                                                    .coerceAtLeast(0),
                                        )
                                    } else {
                                        current
                                    }
                                }
                            }
                        }
                    }
                }
                .onFailure { e ->
                    _state.update {
                        it.copy(sendingCode = false, error = e.message ?: "验证码发送失败")
                    }
                }
        }
    }

    fun register(email: String, password: String, code: String) {
        submit { repository.registerWithInviteCode(email.trim(), password, code.trim()) }
    }

    fun logout() {
        verificationCooldownJob?.cancel()
        viewModelScope.launch {
            repository.logout()
            _state.value = AuthUiState(restoring = false)
        }
    }

    fun dismissError() {
        _state.update { it.copy(error = null) }
    }

    private fun submit(block: suspend () -> Result<AccountResponse>) {
        _state.update { it.copy(submitting = true, error = null) }
        viewModelScope.launch {
            block()
                .onSuccess(::applyAccount)
                .onFailure { e ->
                    _state.update { it.copy(submitting = false, error = e.message ?: "操作失败") }
                }
        }
    }

    private fun applyAccount(response: AccountResponse) {
        verificationCooldownJob?.cancel()
        _state.update {
            it.copy(
                submitting = false,
                sendingCode = false,
                verificationCodeRetryAfter = 0,
                user = response.user,
                quota = response.privateQuota,
                wallet = response.creditWallet,
                error = null,
            )
        }
    }

    companion object {
        val Factory: ViewModelProvider.Factory = viewModelFactory {
            initializer {
                val app = this[APPLICATION_KEY] as XuanshuApplication
                AuthViewModel(app.container.accountRepository, app.container.session)
            }
        }
    }
}
