package tech.zsien.xuanshu.ui.chart

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import com.mikepenz.markdown.model.rememberMarkdownState
import tech.zsien.xuanshu.R
import tech.zsien.xuanshu.core.network.model.ChartResponse
import tech.zsien.xuanshu.core.network.model.PillarDetail
import tech.zsien.xuanshu.ui.components.GanzhiText
import tech.zsien.xuanshu.ui.theme.XuanshuColors
import tech.zsien.xuanshu.ui.theme.elementColor

@Composable
fun ChartScreen(
    state: ChartUiState,
    onInterpret: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val chart = state.chart ?: return
    // 私密问题只保留在当前进程内，避免被写入可恢复的 saved state。
    var question by remember { mutableStateOf("") }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(XuanshuColors.Bg)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        DayMasterHeader(chart)
        PillarsCard(chart)
        WuxingRow(chart)

        HorizontalDivider(color = XuanshuColors.LineSoft)

        OutlinedTextField(
            value = question,
            onValueChange = { question = it },
            label = { Text(stringResource(R.string.interpret_question)) },
            minLines = 2,
            enabled = !state.interpreting,
            shape = RoundedCornerShape(12.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = XuanshuColors.Gold,
                unfocusedBorderColor = XuanshuColors.Line,
                focusedLabelColor = XuanshuColors.GoldDim,
                unfocusedLabelColor = XuanshuColors.Weak,
                cursorColor = XuanshuColors.Gold,
            ),
            modifier = Modifier.fillMaxWidth(),
        )

        Button(
            onClick = { onInterpret(question) },
            enabled = !state.interpreting,
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = XuanshuColors.Gold,
                contentColor = XuanshuColors.Bg,
                disabledContainerColor = XuanshuColors.GoldDark.copy(alpha = 0.35f),
                disabledContentColor = XuanshuColors.Muted,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 2.dp),
        ) {
            if (state.interpreting) {
                CircularProgressIndicator(
                    modifier = Modifier
                        .size(15.dp)
                        .padding(end = 6.dp),
                    strokeWidth = 2.dp,
                    color = XuanshuColors.Muted,
                )
            }
            Text(
                text = stringResource(R.string.interpret_start),
                style = MaterialTheme.typography.labelLarge,
            )
        }

        InterpretSection(state)

        state.error?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.bodySmall,
                color = XuanshuColors.Danger,
            )
        }

        TextButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
            Text(
                text = stringResource(R.string.chart_back),
                color = XuanshuColors.Muted,
                style = MaterialTheme.typography.labelMedium,
            )
        }

        Text(
            text = stringResource(R.string.interpret_disclaimer),
            style = MaterialTheme.typography.labelSmall,
            color = XuanshuColors.Weak,
            modifier = Modifier.padding(bottom = 12.dp),
        )
    }
}

@Composable
private fun DayMasterHeader(chart: ChartResponse) {
    val master = chart.chart.dayMaster
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = stringResource(R.string.chart_day_master_label),
            style = MaterialTheme.typography.labelMedium,
            color = XuanshuColors.Weak,
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            Text(
                text = master.stem,
                style = MaterialTheme.typography.displaySmall,
                color = elementColor(master.element),
            )
            Text(
                text = "${master.yinYang}${master.element} · 生肖${chart.chart.shengxiao}",
                style = MaterialTheme.typography.bodyMedium,
                color = XuanshuColors.Muted,
                modifier = Modifier.padding(bottom = 6.dp),
            )
        }
    }
}

@Composable
private fun PillarsCard(chart: ChartResponse) {
    val detail = chart.pillarsDetail
    Surface(
        color = XuanshuColors.Panel2,
        border = BorderStroke(1.dp, XuanshuColors.Line),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(vertical = 18.dp, horizontal = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            PillarColumn(stringResource(R.string.chart_pillar_year), detail.year, Modifier.weight(1f))
            PillarColumn(stringResource(R.string.chart_pillar_month), detail.month, Modifier.weight(1f))
            PillarColumn(stringResource(R.string.chart_pillar_day), detail.day, Modifier.weight(1f))
            PillarColumn(stringResource(R.string.chart_pillar_hour), detail.hour, Modifier.weight(1f))
        }
    }
}

@Composable
private fun PillarColumn(title: String, pillar: PillarDetail, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Text(title, style = MaterialTheme.typography.labelSmall, color = XuanshuColors.Weak)
        GanzhiText(
            ganzhi = pillar.pillar,
            style = MaterialTheme.typography.headlineMedium,
        )
        Text(
            text = pillar.stemTenGod,
            style = MaterialTheme.typography.labelMedium,
            color = XuanshuColors.GoldDim,
        )
        // 藏干用更弱的层级，避免与主干支抢视线
        pillar.hidden.forEach { hidden ->
            Text(
                text = "${hidden.stem}·${hidden.tenGod}",
                style = MaterialTheme.typography.labelSmall,
                color = XuanshuColors.Weak,
            )
        }
    }
}

@Composable
private fun WuxingRow(chart: ChartResponse) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = stringResource(R.string.chart_wuxing),
            style = MaterialTheme.typography.labelMedium,
            color = XuanshuColors.Weak,
        )
        chart.wuxingCount.forEach { (element, count) ->
            Surface(
                color = elementColor(element).copy(alpha = if (count > 0) 0.14f else 0.05f),
                shape = RoundedCornerShape(8.dp),
            ) {
                Text(
                    text = "$element $count",
                    style = MaterialTheme.typography.labelMedium,
                    color = if (count > 0) elementColor(element) else XuanshuColors.Weak,
                    modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
                )
            }
        }
    }
}

@Composable
private fun InterpretSection(state: ChartUiState) {
    val task = state.task ?: return
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (!task.isTerminal) {
            // 解读要跑 70~95 秒，必须让用户看得到进度，否则会以为卡死。
            LinearProgressIndicator(
                color = XuanshuColors.Gold,
                trackColor = XuanshuColors.Panel3,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                text = stringResource(R.string.interpret_running),
                style = MaterialTheme.typography.bodySmall,
                color = XuanshuColors.Muted,
            )
        }
        if (task.answer.isNotBlank()) {
            Surface(
                color = XuanshuColors.Panel,
                border = BorderStroke(1.dp, XuanshuColors.LineSoft),
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                // 解读正文是 Markdown（标题、强调、列表都有），必须渲染而非直出原文。
                // 默认 h1/h2 在手机上大得离谱，这里全部收敛到正文层级附近，
                // 让长文读起来是「一篇文章」而不是「一串大标题」。
                val markdownState = rememberMarkdownState(content = task.answer)
                Markdown(
                    markdownState = markdownState,
                    typography = markdownTypography(
                        h1 = MaterialTheme.typography.headlineSmall,
                        h2 = MaterialTheme.typography.titleMedium,
                        h3 = MaterialTheme.typography.titleMedium,
                        h4 = MaterialTheme.typography.labelLarge,
                        h5 = MaterialTheme.typography.labelLarge,
                        h6 = MaterialTheme.typography.labelMedium,
                        text = MaterialTheme.typography.bodyMedium,
                        paragraph = MaterialTheme.typography.bodyMedium,
                        list = MaterialTheme.typography.bodyMedium,
                    ),
                    colors = markdownColor(
                        text = XuanshuColors.Text2,
                        dividerColor = XuanshuColors.LineSoft,
                    ),
                    modifier = Modifier.padding(16.dp),
                )
            }
        }
    }
}
