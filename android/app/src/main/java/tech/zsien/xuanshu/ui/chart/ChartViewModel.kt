package tech.zsien.xuanshu.ui.chart

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
import tech.zsien.xuanshu.core.network.model.ChartRequest
import tech.zsien.xuanshu.core.network.model.ChartResponse
import tech.zsien.xuanshu.core.network.model.InterpretRequest
import tech.zsien.xuanshu.core.network.model.InterpretTask
import tech.zsien.xuanshu.core.network.newSessionId
import tech.zsien.xuanshu.data.ChartRepository

data class BirthForm(
    val year: String = "1990",
    val month: String = "6",
    val day: String = "15",
    val hour: String = "10",
    val minute: String = "30",
    val gender: String = "male",
    val location: String = "北京",
)

data class ChartUiState(
    val form: BirthForm = BirthForm(),
    val casting: Boolean = false,
    val chart: ChartResponse? = null,
    val task: InterpretTask? = null,
    val interpreting: Boolean = false,
    val error: String? = null,
)

class ChartViewModel(private val repository: ChartRepository) : ViewModel() {

    private val _state = MutableStateFlow(ChartUiState())
    val state: StateFlow<ChartUiState> = _state.asStateFlow()

    private var streamJob: Job? = null

    /** 同一个命盘下的连续追问共用一个会话，服务端据此串成一段对话并留档。 */
    private var sessionId: String = newSessionId()

    fun updateForm(form: BirthForm) = _state.update { it.copy(form = form) }

    fun castChart() {
        val form = _state.value.form
        val request = runCatching {
            ChartRequest(
                year = form.year.trim().toInt(),
                month = form.month.trim().toInt(),
                day = form.day.trim().toInt(),
                hour = form.hour.trim().toInt(),
                minute = form.minute.trim().ifBlank { "0" }.toInt(),
                gender = form.gender,
                location = form.location.trim(),
            )
        }.getOrElse {
            _state.update { s -> s.copy(error = "请填写完整且正确的出生时间") }
            return
        }

        _state.update { it.copy(casting = true, error = null) }
        viewModelScope.launch {
            repository.createChart(request)
                .onSuccess { chart -> _state.update { it.copy(casting = false, chart = chart) } }
                .onFailure { e -> _state.update { it.copy(casting = false, error = e.message) } }
        }
    }

    fun interpret(question: String) {
        val chartId = _state.value.chart?.chartId ?: return
        val form = _state.value.form
        _state.update { it.copy(interpreting = true, error = null, task = null) }
        viewModelScope.launch {
            repository.startInterpret(
                InterpretRequest(
                    scenario = if (question.isBlank()) "natal" else "topic",
                    question = question.trim(),
                    chartId = chartId,
                    profileId = _state.value.chart?.profileId,
                    sessionId = sessionId,
                    // 服务端会用这些重建命盘，必须与起盘时填的一致。
                    year = form.year.trim().toIntOrNull() ?: 0,
                    month = form.month.trim().toIntOrNull() ?: 0,
                    day = form.day.trim().toIntOrNull() ?: 0,
                    hour = form.hour.trim().toIntOrNull() ?: 0,
                    minute = form.minute.trim().toIntOrNull() ?: 0,
                    gender = form.gender,
                    location = form.location.trim(),
                )
            )
                .onSuccess { started ->
                    _state.update { it.copy(task = started) }
                    observe(started.taskId)
                }
                .onFailure { e ->
                    _state.update { it.copy(interpreting = false, error = e.message) }
                }
        }
    }

    /** 回到前台时补一次快照，不必干等下一帧 SSE。 */
    fun refreshTask() {
        val taskId = _state.value.task?.taskId ?: return
        if (_state.value.task?.isTerminal == true) return
        viewModelScope.launch {
            repository.fetchTask(taskId).onSuccess { task -> _state.update { it.copy(task = task) } }
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
        // 换一个盘就是换一段对话，会话 ID 必须跟着换
        sessionId = newSessionId()
        _state.update { ChartUiState(form = it.form) }
    }

    fun dismissError() = _state.update { it.copy(error = null) }

    companion object {
        val Factory: ViewModelProvider.Factory = viewModelFactory {
            initializer {
                val app = this[APPLICATION_KEY] as XuanshuApplication
                ChartViewModel(app.container.chartRepository)
            }
        }
    }
}
