package tech.zsien.xuanshu.ui.liuyao

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import com.mikepenz.markdown.model.rememberMarkdownState
import tech.zsien.xuanshu.R
import tech.zsien.xuanshu.core.network.model.LiuyaoChart
import tech.zsien.xuanshu.core.network.model.Yao
import tech.zsien.xuanshu.ui.theme.XuanshuColors
import tech.zsien.xuanshu.ui.theme.elementColor

@Composable
fun GuaScreen(
    state: LiuyaoUiState,
    onInterpret: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val gua = state.chart ?: return

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(XuanshuColors.Bg)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        GuaHeader(gua)
        GuaMeta(gua)
        YaoTable(gua)

        Button(
            onClick = onInterpret,
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
                .height(52.dp),
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
            Text(stringResource(R.string.liuyao_interpret), style = MaterialTheme.typography.labelLarge)
        }

        InterpretBlock(state)

        state.error?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = XuanshuColors.Danger)
        }

        TextButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
            Text(
                text = stringResource(R.string.liuyao_new_cast),
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
private fun GuaHeader(gua: LiuyaoChart) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                text = gua.benGua.name,
                style = MaterialTheme.typography.headlineMedium,
                color = XuanshuColors.GoldBright,
            )
            gua.bianGua?.name?.takeIf { it.isNotBlank() }?.let { bian ->
                Text(
                    text = "→ $bian",
                    style = MaterialTheme.typography.bodyLarge,
                    color = XuanshuColors.GoldDim,
                    modifier = Modifier.padding(bottom = 3.dp),
                )
            }
        }
        Text(
            text = gua.question,
            style = MaterialTheme.typography.bodyMedium,
            color = XuanshuColors.Text2,
        )
        // 起卦时刻是断卦的前提之一，要让用户看得到这一卦是什么时候成的
        Text(
            text = "${gua.castTime.solar} · ${gua.castTime.hourZhi}时",
            style = MaterialTheme.typography.labelSmall,
            color = XuanshuColors.Weak,
        )
    }
}

@Composable
private fun GuaMeta(gua: LiuyaoChart) {
    val palace = buildString {
        append(gua.benGua.palace).append("宫")
        if (gua.benGua.palaceLabel.isNotBlank()) append(" · ").append(gua.benGua.palaceLabel)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        MetaItem(stringResource(R.string.liuyao_palace), palace)
        MetaItem(stringResource(R.string.liuyao_month), gua.monthJian)
        MetaItem(stringResource(R.string.liuyao_day), gua.dayChen)
        MetaItem(stringResource(R.string.liuyao_kong), gua.xunKong)
    }
}

@Composable
private fun MetaItem(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = XuanshuColors.Weak)
        Text(value, style = MaterialTheme.typography.labelMedium, color = XuanshuColors.Text2)
    }
}

/** 六爻自上而下排列：第六爻在最上，初爻在最下，与纸面排盘一致。 */
@Composable
private fun YaoTable(gua: LiuyaoChart) {
    Surface(
        color = XuanshuColors.Panel2,
        border = BorderStroke(1.dp, XuanshuColors.Line),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(vertical = 14.dp, horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            gua.yaos.sortedByDescending { it.pos }.forEach { yao ->
                YaoRow(yao)
            }
        }
    }
}

@Composable
private fun YaoRow(yao: Yao) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = yao.liuShen,
            style = MaterialTheme.typography.labelSmall,
            color = XuanshuColors.Weak,
            modifier = Modifier.width(30.dp),
        )
        Text(
            text = yao.liuQin,
            style = MaterialTheme.typography.labelMedium,
            color = XuanshuColors.GoldDim,
            modifier = Modifier.width(34.dp),
        )
        Text(
            text = yao.najia,
            style = MaterialTheme.typography.labelMedium,
            color = elementColor(yao.wuxing),
            modifier = Modifier.width(38.dp),
        )

        YaoLine(yao, modifier = Modifier.weight(1f))

        // 动爻标记：老阳○、老阴×，这是六爻盘上最关键的一列
        Text(
            text = if (yao.moving) (if (yao.isYang) "○" else "×") else "",
            style = MaterialTheme.typography.labelMedium,
            color = XuanshuColors.Danger,
            textAlign = TextAlign.Center,
            modifier = Modifier.width(16.dp),
        )
        Text(
            text = when {
                yao.shi -> stringResource(R.string.liuyao_shi)
                yao.ying -> stringResource(R.string.liuyao_ying)
                else -> ""
            },
            style = MaterialTheme.typography.labelMedium,
            color = XuanshuColors.GoldBright,
            modifier = Modifier.width(18.dp),
        )
        Text(
            text = if (yao.kong) stringResource(R.string.liuyao_kong_mark) else "",
            style = MaterialTheme.typography.labelSmall,
            color = XuanshuColors.Weak,
            modifier = Modifier.width(18.dp),
        )
    }
}

/** 阳爻一条实线，阴爻中间断开——即卦画本身。 */
@Composable
private fun YaoLine(yao: Yao, modifier: Modifier = Modifier) {
    val color = if (yao.moving) XuanshuColors.GoldBright else XuanshuColors.Text2
    Row(
        modifier = modifier.height(12.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (yao.isYang) {
            Box(
                Modifier
                    .weight(1f)
                    .height(5.dp)
                    .background(color, RoundedCornerShape(2.dp)),
            )
        } else {
            Box(
                Modifier
                    .weight(1f)
                    .height(5.dp)
                    .background(color, RoundedCornerShape(2.dp)),
            )
            Box(
                Modifier
                    .weight(1f)
                    .height(5.dp)
                    .background(color, RoundedCornerShape(2.dp)),
            )
        }
    }
}

@Composable
private fun InterpretBlock(state: LiuyaoUiState) {
    val task = state.task ?: return
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (!task.isTerminal) {
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
                val markdownState = rememberMarkdownState(content = task.answer)
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
                    modifier = Modifier.padding(16.dp),
                )
            }
        }
    }
}
