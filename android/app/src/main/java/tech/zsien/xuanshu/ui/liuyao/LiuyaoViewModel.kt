package tech.zsien.xuanshu.ui.liuyao

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import tech.zsien.xuanshu.XuanshuApplication
import tech.zsien.xuanshu.core.network.model.InterpretRequest
import tech.zsien.xuanshu.core.network.model.InterpretTask
import tech.zsien.xuanshu.core.network.model.LiuyaoCastRequest
import tech.zsien.xuanshu.core.network.model.LiuyaoChart
import tech.zsien.xuanshu.core.network.newSessionId
import tech.zsien.xuanshu.data.ChartRepository

/** 摇满这么多次才起卦，对应三枚铜钱。 */
const val REQUIRED_SHAKES = 3

data class LiuyaoUiState(
    val question: String = "",
    val shakeCount: Int = 0,
    val casting: Boolean = false,
    val chart: LiuyaoChart? = null,
    val task: InterpretTask? = null,
    val interpreting: Boolean = false,
    val error: String? = null,
) {
    val questionReady: Boolean get() = question.isNotBlank()
    val readyToCast: Boolean get() = shakeCount >= REQUIRED_SHAKES
}

class LiuyaoViewModel(private val repository: ChartRepository) : ViewModel() {

    private val _state = MutableStateFlow(LiuyaoUiState())
    val state: StateFlow<LiuyaoUiState> = _state.asStateFlow()

    private var streamJob: Job? = null

    /** 同一卦下的连续追问共用一个会话，服务端据此留档。 */
    private var sessionId: String = newSessionId()

    fun updateQuestion(question: String) = _state.update { it.copy(question = question, error = null) }

    /**
     * 摇动一次。摇满即起卦。
     *
     * 摇动只是交互——卦象由服务端代摇产生，客户端不参与随机。
     */
    fun onShake() {
        val current = _state.value
        if (!current.questionReady || current.casting || current.chart != null) return
        val next = (current.shakeCount + 1).coerceAtMost(REQUIRED_SHAKES)
        _state.update { it.copy(shakeCount = next) }
        if (next >= REQUIRED_SHAKES) cast()
    }

    fun cast() {
        val current = _state.value
        if (!current.questionReady) {
            _state.update { it.copy(error = "请先写下要问的事") }
            return
        }
        if (current.casting || current.chart != null) return

        _state.update { it.copy(casting = true, error = null, shakeCount = REQUIRED_SHAKES) }
        viewModelScope.launch {
            repository.castLiuyao(LiuyaoCastRequest(question = current.question.trim()))
                .onSuccess { gua -> _state.update { it.copy(casting = false, chart = gua) } }
                .onFailure { e ->
                    // 起卦失败要把摇动次数退回去，否则用户会卡在「已摇满但没有卦」的状态
                    _state.update { it.copy(casting = false, shakeCount = 0, error = e.message) }
                }
        }
    }

    fun interpret() {
        val gua = _state.value.chart ?: return
        _state.update { it.copy(interpreting = true, error = null, task = null) }
        viewModelScope.launch {
            repository.startInterpret(
                InterpretRequest(
                    system = "liuyao",
                    scenario = "divination",
                    question = gua.question,
                    chartId = gua.chartId,
                    profileId = gua.profileId,
                    sessionId = sessionId,
                )
            )
                .onSuccess { started ->
                    _state.update { it.copy(task = started) }
                    observe(started.taskId)
                }
                .onFailure { e -> _state.update { it.copy(interpreting = false, error = e.message) } }
        }
    }

    private fun observe(taskId: String) {
        streamJob?.cancel()
        streamJob = viewModelScope.launch {
            repository.observeTask(taskId)
                .catch { e -> _state.update { it.copy(interpreting = false, error = e.message) } }
                .collect { task ->
                    _state.update {
                        it.copy(
                            task = task,
                            interpreting = !task.isTerminal,
                            error = if (task.isFailed) task.error.ifBlank { "解读失败" } else it.error,
                        )
                    }
                }
        }
    }

    fun reset() {
        streamJob?.cancel()
        sessionId = newSessionId()
        _state.value = LiuyaoUiState()
    }

    companion object {
        val Factory: ViewModelProvider.Factory = viewModelFactory {
            initializer {
                val app = this[APPLICATION_KEY] as XuanshuApplication
                LiuyaoViewModel(app.container.chartRepository)
            }
        }
    }
}
