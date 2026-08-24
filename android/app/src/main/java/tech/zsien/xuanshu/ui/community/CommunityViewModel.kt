package tech.zsien.xuanshu.ui.community

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
import tech.zsien.xuanshu.core.network.model.CommunityComment
import tech.zsien.xuanshu.core.network.model.CommunityPost
import tech.zsien.xuanshu.data.ChartRepository

data class CommunityUiState(
    val loading: Boolean = true,
    val posts: List<CommunityPost> = emptyList(),
    val nextCursor: String? = null,
    val loadingMore: Boolean = false,
    /** 打开的帖子；为 null 时显示列表。 */
    val selected: CommunityPost? = null,
    val detailLoading: Boolean = false,
    val comments: List<CommunityComment> = emptyList(),
    val error: String? = null,
) {
    val hasMore: Boolean get() = !nextCursor.isNullOrBlank()
}

class CommunityViewModel(private val repository: ChartRepository) : ViewModel() {

    private val _state = MutableStateFlow(CommunityUiState())
    val state: StateFlow<CommunityUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            repository.communityFeed()
                .onSuccess { feed ->
                    _state.update {
                        it.copy(loading = false, posts = feed.items, nextCursor = feed.nextCursor)
                    }
                }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.message) } }
        }
    }

    fun loadMore() {
        val current = _state.value
        val cursor = current.nextCursor
        if (cursor.isNullOrBlank() || current.loadingMore) return
        _state.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            repository.communityFeed(cursor)
                .onSuccess { feed ->
                    _state.update {
                        it.copy(
                            loadingMore = false,
                            posts = it.posts + feed.items,
                            nextCursor = feed.nextCursor,
                        )
                    }
                }
                .onFailure { e -> _state.update { it.copy(loadingMore = false, error = e.message) } }
        }
    }

    fun open(post: CommunityPost) {
        // 列表接口不带正文，详情要单独拉一次
        _state.update { it.copy(selected = post, detailLoading = true, comments = emptyList()) }
        viewModelScope.launch {
            repository.communityPost(post.slug)
                .onSuccess { full -> _state.update { it.copy(selected = full, detailLoading = false) } }
                .onFailure { e -> _state.update { it.copy(detailLoading = false, error = e.message) } }
            if (post.commentsEnabled) {
                repository.communityComments(post.slug)
                    .onSuccess { c -> _state.update { it.copy(comments = c.items) } }
            }
        }
    }

    /** 返回 false 表示已在列表层。 */
    fun back(): Boolean {
        if (_state.value.selected == null) return false
        _state.update { it.copy(selected = null, comments = emptyList()) }
        return true
    }

    companion object {
        val Factory: ViewModelProvider.Factory = viewModelFactory {
            initializer {
                val app = this[APPLICATION_KEY] as XuanshuApplication
                CommunityViewModel(app.container.chartRepository)
            }
        }
    }
}
