package tech.zsien.xuanshu.ui.credits

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
import kotlinx.coroutines.launch
import tech.zsien.xuanshu.XuanshuApplication
import tech.zsien.xuanshu.core.network.model.CreditActivityPage
import tech.zsien.xuanshu.core.network.model.PaymentOrderPage
import tech.zsien.xuanshu.data.AccountRepository

enum class CreditHistoryTab { ACTIVITY, ORDERS }

data class CreditHistoryUiState(
    val tab: CreditHistoryTab = CreditHistoryTab.ACTIVITY,
    val filter: String = "all",
    val loading: Boolean = false,
    val activity: CreditActivityPage? = null,
    val orders: PaymentOrderPage? = null,
    val error: String? = null,
) {
    val page: Int
        get() = if (tab == CreditHistoryTab.ACTIVITY) {
            activity?.pagination?.page ?: 1
        } else {
            orders?.pagination?.page ?: 1
        }
    val pageCount: Int
        get() = if (tab == CreditHistoryTab.ACTIVITY) {
            activity?.pagination?.pageCount ?: 1
        } else {
            orders?.pagination?.pageCount ?: 1
        }
}

class CreditHistoryViewModel(
    private val repository: AccountRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(CreditHistoryUiState())
    val state: StateFlow<CreditHistoryUiState> = _state.asStateFlow()
    private var loadJob: Job? = null
    private var loadGeneration = 0L

    init {
        load(page = 1)
    }

    fun refresh() = load(page = 1)

    fun selectTab(tab: CreditHistoryTab) {
        if (_state.value.tab == tab) return
        _state.update { it.copy(tab = tab, filter = "all", error = null) }
        load(page = 1)
    }

    fun selectFilter(filter: String) {
        if (_state.value.filter == filter) return
        _state.update { it.copy(filter = filter, error = null) }
        load(page = 1)
    }

    fun previousPage() {
        if (_state.value.page > 1) load(_state.value.page - 1)
    }

    fun nextPage() {
        if (_state.value.page < _state.value.pageCount) load(_state.value.page + 1)
    }

    private fun load(page: Int) {
        val tab = _state.value.tab
        val filter = _state.value.filter
        val generation = ++loadGeneration
        loadJob?.cancel()
        _state.update { it.copy(loading = true, error = null) }
        loadJob = viewModelScope.launch {
            if (tab == CreditHistoryTab.ACTIVITY) {
                repository.creditActivity(page, filter)
                    .onSuccess { payload ->
                        if (generation != loadGeneration) return@onSuccess
                        _state.update {
                            it.copy(loading = false, activity = payload, error = null)
                        }
                    }
                    .onFailure { applyFailure(generation, it) }
            } else {
                repository.paymentOrders(page, filter)
                    .onSuccess { payload ->
                        if (generation != loadGeneration) return@onSuccess
                        _state.update {
                            it.copy(loading = false, orders = payload, error = null)
                        }
                    }
                    .onFailure { applyFailure(generation, it) }
            }
        }
    }

    private fun applyFailure(generation: Long, reason: Throwable) {
        if (generation != loadGeneration) return
        _state.update {
            it.copy(loading = false, error = reason.message ?: "积分明细加载失败")
        }
    }

    companion object {
        val Factory: ViewModelProvider.Factory = viewModelFactory {
            initializer {
                val app = this[APPLICATION_KEY] as XuanshuApplication
                CreditHistoryViewModel(app.container.accountRepository)
            }
        }
    }
}
