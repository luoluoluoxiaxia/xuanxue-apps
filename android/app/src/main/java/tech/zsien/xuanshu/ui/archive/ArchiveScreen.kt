package tech.zsien.xuanshu.ui.archive

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
import tech.zsien.xuanshu.core.network.model.InterpretHistoryItem
import tech.zsien.xuanshu.core.network.model.ProfileItem
import tech.zsien.xuanshu.ui.components.GanzhiText
import tech.zsien.xuanshu.ui.theme.XuanshuColors

@Composable
fun ArchiveScreen(
    state: ArchiveUiState,
    onOpenProfile: (ProfileItem) -> Unit,
    onOpenReading: (InterpretHistoryItem) -> Unit,
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
            text = when {
                state.reading != null -> state.reading.question.ifBlank { stringResource(R.string.archive_reading) }
                state.selected != null -> state.selected.name
                else -> stringResource(R.string.archive_title)
            },
            style = MaterialTheme.typography.headlineMedium,
            color = XuanshuColors.GoldBright,
            modifier = Modifier.padding(bottom = 14.dp),
        )

        Box(modifier = Modifier.weight(1f)) {
            when {
                state.reading != null -> ReadingContent(state.reading)
                state.selected != null -> HistoryList(state, onOpenReading)
                state.loading -> Loading()
                state.profiles.isEmpty() -> EmptyHint(stringResource(R.string.archive_empty))
                else -> ProfileList(state.profiles, onOpenProfile)
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
private fun Loading() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = XuanshuColors.Gold)
    }
}

@Composable
private fun EmptyHint(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, style = MaterialTheme.typography.bodyMedium, color = XuanshuColors.Weak)
    }
}

@Composable
private fun ProfileList(profiles: List<ProfileItem>, onOpen: (ProfileItem) -> Unit) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items(profiles, key = { it.id }) { profile ->
            Surface(
                onClick = { onOpen(profile) },
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
                        text = profile.name,
                        style = MaterialTheme.typography.bodyLarge,
                        color = XuanshuColors.Text,
                    )
                    if (profile.isBazi) {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            val p = profile.summary.pillars
                            listOf(p.year, p.month, p.day, p.hour)
                                .filter { it.isNotBlank() }
                                .forEach { GanzhiText(it, style = MaterialTheme.typography.labelLarge) }
                        }
                    } else if (profile.summary.question.isNotBlank()) {
                        Text(
                            text = profile.summary.question,
                            style = MaterialTheme.typography.bodySmall,
                            color = XuanshuColors.Muted,
                        )
                    }
                    Text(
                        text = stringResource(R.string.archive_history_count, profile.historyCount),
                        style = MaterialTheme.typography.labelSmall,
                        color = XuanshuColors.Weak,
                    )
                }
            }
        }
    }
}

@Composable
private fun HistoryList(state: ArchiveUiState, onOpen: (InterpretHistoryItem) -> Unit) {
    when {
        state.historyLoading -> Loading()
        state.history.isEmpty() -> EmptyHint(stringResource(R.string.archive_no_history))
        else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(state.history, key = { it.id }) { item ->
                Surface(
                    onClick = { onOpen(item) },
                    color = XuanshuColors.Panel2,
                    border = BorderStroke(1.dp, XuanshuColors.LineSoft),
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            text = item.question.ifBlank { stringResource(R.string.archive_whole_chart) },
                            style = MaterialTheme.typography.bodyMedium,
                            color = XuanshuColors.Text,
                        )
                        // 正文首行当摘要，让用户不点开也能认出是哪一条
                        Text(
                            text = item.answer.lineSequence()
                                .firstOrNull { it.isNotBlank() && !it.startsWith("#") }
                                ?.take(48)
                                .orEmpty(),
                            style = MaterialTheme.typography.bodySmall,
                            color = XuanshuColors.Muted,
                        )
                        Text(
                            text = item.createdAt.replace('T', ' '),
                            style = MaterialTheme.typography.labelSmall,
                            color = XuanshuColors.Weak,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ReadingContent(item: InterpretHistoryItem) {
    Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
        val markdownState = rememberMarkdownState(content = item.answer)
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
        Spacer(Modifier.height(20.dp))
    }
}
