package tech.zsien.xuanshu.ui.archive

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
import tech.zsien.xuanshu.core.network.model.InterpretHistoryItem
import tech.zsien.xuanshu.core.network.model.ProfileItem
import tech.zsien.xuanshu.data.ChartRepository

data class ArchiveUiState(
    val loading: Boolean = true,
    val profiles: List<ProfileItem> = emptyList(),
    val selected: ProfileItem? = null,
    val historyLoading: Boolean = false,
    val history: List<InterpretHistoryItem> = emptyList(),
    /** 正在阅读的那条留档；为 null 时显示列表。 */
    val reading: InterpretHistoryItem? = null,
    val error: String? = null,
)

class ArchiveViewModel(private val repository: ChartRepository) : ViewModel() {

    private val _state = MutableStateFlow(ArchiveUiState())
    val state: StateFlow<ArchiveUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            repository.profiles()
                .onSuccess { list ->
                    _state.update { it.copy(loading = false, profiles = list) }
                }
                .onFailure { e ->
                    _state.update { it.copy(loading = false, error = e.message) }
                }
        }
    }

    fun openProfile(profile: ProfileItem) {
        _state.update { it.copy(selected = profile, historyLoading = true, history = emptyList()) }
        viewModelScope.launch {
            repository.interpretations(profile.id)
                .onSuccess { list ->
                    // 新的在前，用户最关心刚跑完的那条
                    _state.update { it.copy(historyLoading = false, history = list.sortedByDescending(InterpretHistoryItem::id)) }
                }
                .onFailure { e ->
                    _state.update { it.copy(historyLoading = false, error = e.message) }
                }
        }
    }

    fun openReading(item: InterpretHistoryItem) = _state.update { it.copy(reading = item) }

    /** 返回上一层：阅读 → 历史列表 → 档案列表。返回 false 表示已在最外层。 */
    fun back(): Boolean {
        val current = _state.value
        return when {
            current.reading != null -> {
                _state.update { it.copy(reading = null) }
                true
            }
            current.selected != null -> {
                _state.update { it.copy(selected = null, history = emptyList()) }
                true
            }
            else -> false
        }
    }

    companion object {
        val Factory: ViewModelProvider.Factory = viewModelFactory {
            initializer {
                val app = this[APPLICATION_KEY] as XuanshuApplication
                ArchiveViewModel(app.container.chartRepository)
            }
        }
    }
}
