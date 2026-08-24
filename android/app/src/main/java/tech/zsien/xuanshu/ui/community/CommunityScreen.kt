package tech.zsien.xuanshu.ui.community

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import com.mikepenz.markdown.model.rememberMarkdownState
import tech.zsien.xuanshu.R
import tech.zsien.xuanshu.core.network.model.CommunityPost
import tech.zsien.xuanshu.ui.theme.XuanshuColors

@Composable
fun CommunityScreen(
    state: CommunityUiState,
    onOpen: (CommunityPost) -> Unit,
    onLoadMore: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(XuanshuColors.Bg)
            .safeDrawingPadding()
            .padding(horizontal = 20.dp),
    ) {
        Spacer(Modifier.height(60.dp))

        Text(
            text = state.selected?.question?.takeIf { it.isNotBlank() }
                ?: stringResource(R.string.community_title),
            style = MaterialTheme.typography.headlineMedium,
            color = XuanshuColors.GoldBright,
            modifier = Modifier.padding(bottom = 14.dp),
        )

        Box(Modifier.weight(1f)) {
            when {
                state.selected != null -> PostDetail(state)
                state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = XuanshuColors.Gold)
                }
                state.posts.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        text = stringResource(R.string.community_empty),
                        style = MaterialTheme.typography.bodyMedium,
                        color = XuanshuColors.Weak,
                    )
                }
                else -> PostList(state, onOpen, onLoadMore)
            }
        }

        state.error?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = XuanshuColors.Danger)
        }

        TextButton(onClick = onBack, modifier = Modifier.padding(bottom = 10.dp)) {
            Text(
                text = stringResource(R.string.common_back),
                color = XuanshuColors.Weak,
                style = MaterialTheme.typography.labelMedium,
            )
        }
    }
}

@Composable
private fun PostList(
    state: CommunityUiState,
    onOpen: (CommunityPost) -> Unit,
    onLoadMore: () -> Unit,
) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items(state.posts, key = { it.slug }) { post ->
            Surface(
                onClick = { onOpen(post) },
                color = XuanshuColors.Panel2,
                border = BorderStroke(1.dp, XuanshuColors.Line),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = post.question.ifBlank { post.title },
                        style = MaterialTheme.typography.bodyLarge,
                        color = XuanshuColors.Text,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (post.questionTypeLabel.isNotBlank()) {
                            Surface(
                                color = XuanshuColors.Gold.copy(alpha = 0.12f),
                                shape = RoundedCornerShape(6.dp),
                            ) {
                                Text(
                                    text = post.questionTypeLabel,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = XuanshuColors.GoldDim,
                                    modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
                                )
                            }
                        }
                        Text(
                            text = stringResource(
                                R.string.community_stats,
                                post.viewCount,
                                post.likeCount,
                                post.commentCount,
                            ),
                            style = MaterialTheme.typography.labelSmall,
                            color = XuanshuColors.Weak,
                        )
                    }
                }
            }
        }

        if (state.hasMore) {
            item {
                TextButton(onClick = onLoadMore, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = if (state.loadingMore) {
                            stringResource(R.string.common_loading)
                        } else {
                            stringResource(R.string.community_load_more)
                        },
                        color = XuanshuColors.GoldDim,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
        }
    }
}

@Composable
private fun PostDetail(state: CommunityUiState) {
    val post = state.selected ?: return
    Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
        if (state.detailLoading) {
            CircularProgressIndicator(color = XuanshuColors.Gold, modifier = Modifier.padding(8.dp))
        }
        if (post.answer.isNotBlank()) {
            val markdownState = rememberMarkdownState(content = post.answer)
            Markdown(
                markdownState = markdownState,
                typography = markdownTypography(
                    h1 = MaterialTheme.typography.headlineSmall,
                    h2 = MaterialTheme.typography.titleMedium,
                    h3 = MaterialTheme.typography.titleMedium,
                    text = MaterialTheme.typography.bodyMedium,
                    paragraph = MaterialTheme.typography.bodyMedium,
                    list = MaterialTheme.typography.bodyMedium,
                ),
                colors = markdownColor(
                    text = XuanshuColors.Text2,
                    dividerColor = XuanshuColors.LineSoft,
                ),
            )
        }

        if (state.comments.isNotEmpty()) {
            Spacer(Modifier.height(18.dp))
            HorizontalDivider(color = XuanshuColors.LineSoft)
            Spacer(Modifier.height(12.dp))
            Text(
                text = stringResource(R.string.community_comments, state.comments.size),
                style = MaterialTheme.typography.labelMedium,
                color = XuanshuColors.Weak,
            )
            state.comments.forEach { comment ->
                Column(modifier = Modifier.padding(top = 10.dp)) {
                    Text(
                        text = comment.displayName.ifBlank { stringResource(R.string.community_anonymous) },
                        style = MaterialTheme.typography.labelSmall,
                        color = XuanshuColors.GoldDim,
                    )
                    Text(
                        text = comment.body,
                        style = MaterialTheme.typography.bodySmall,
                        color = XuanshuColors.Text2,
                    )
                }
            }
        }

        // 公开帖是匿名脱敏的，明确告诉浏览者这里不含生辰
        Spacer(Modifier.height(16.dp))
        Text(
            text = stringResource(R.string.community_privacy_note),
            style = MaterialTheme.typography.labelSmall,
            color = XuanshuColors.Weak,
        )
        Spacer(Modifier.height(20.dp))
    }
}
