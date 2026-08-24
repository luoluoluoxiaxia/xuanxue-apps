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
import kotlinx.coroutines.launch
import tech.zsien.xuanshu.XuanshuApplication
import tech.zsien.xuanshu.core.network.model.AccountResponse
import tech.zsien.xuanshu.core.network.model.AccountUser
import tech.zsien.xuanshu.core.network.model.PrivateQuota
import tech.zsien.xuanshu.data.AccountRepository
import tech.zsien.xuanshu.data.SessionManager

data class AuthUiState(
    /** 启动时先恢复本地令牌，恢复完成前不该闪一下登录页。 */
    val restoring: Boolean = true,
    val submitting: Boolean = false,
    val user: AccountUser? = null,
    val quota: PrivateQuota? = null,
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

    fun register(email: String, password: String) {
        submit { repository.registerWithInviteCode(email.trim(), password) }
    }

    fun logout() {
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
        _state.update {
            it.copy(
                submitting = false,
                user = response.user,
                quota = response.privateQuota,
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
