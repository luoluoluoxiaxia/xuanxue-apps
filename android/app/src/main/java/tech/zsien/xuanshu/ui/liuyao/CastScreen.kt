package tech.zsien.xuanshu.ui.liuyao

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import tech.zsien.xuanshu.R
import tech.zsien.xuanshu.ui.theme.XuanshuColors

@Composable
fun CastScreen(
    state: LiuyaoUiState,
    onQuestionChange: (String) -> Unit,
    onShake: () -> Unit,
    onCast: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current

    // 只在「问题已填、卦未成」时监听，避免白白耗电
    rememberShakeDetector(enabled = state.questionReady && state.chart == null && !state.casting) {
        context.playSingleCoinHaptic()
        onShake()
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(XuanshuColors.Bg)
            .safeDrawingPadding()
            .padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Spacer(Modifier.height(70.dp))

        Text(
            text = stringResource(R.string.liuyao_title),
            style = MaterialTheme.typography.headlineMedium,
            color = XuanshuColors.GoldBright,
        )
        Text(
            text = stringResource(R.string.liuyao_subtitle),
            style = MaterialTheme.typography.bodySmall,
            color = XuanshuColors.Muted,
        )

        OutlinedTextField(
            value = state.question,
            onValueChange = onQuestionChange,
            label = { Text(stringResource(R.string.liuyao_question)) },
            minLines = 2,
            enabled = state.chart == null && !state.casting,
            shape = RoundedCornerShape(12.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = XuanshuColors.Gold,
                unfocusedBorderColor = XuanshuColors.Line,
                focusedLabelColor = XuanshuColors.GoldDim,
                unfocusedLabelColor = XuanshuColors.Weak,
                cursorColor = XuanshuColors.Gold,
                focusedTextColor = XuanshuColors.Text,
                unfocusedTextColor = XuanshuColors.Text,
            ),
            modifier = Modifier.fillMaxWidth(),
        )

        // 手机上打字成本高，常见问题给一排快捷选项
        if (state.chart == null && !state.casting) {
            PresetQuestions(onPick = onQuestionChange)
        }

        Spacer(Modifier.height(4.dp))

        CoinRow(shakeCount = state.shakeCount)

        Text(
            text = when {
                state.casting -> stringResource(R.string.liuyao_casting)
                !state.questionReady -> stringResource(R.string.liuyao_need_question)
                else -> stringResource(R.string.liuyao_shake_hint, REQUIRED_SHAKES - state.shakeCount)
            },
            style = MaterialTheme.typography.bodySmall,
            color = XuanshuColors.Muted,
            modifier = Modifier.fillMaxWidth(),
        )

        Text(
            text = state.error.orEmpty(),
            style = MaterialTheme.typography.bodySmall,
            color = XuanshuColors.Danger,
            modifier = Modifier.height(20.dp),
        )

        // 没有加速度计的设备（含大多数模拟器）靠这个按钮起卦
        Button(
            onClick = onCast,
            enabled = state.questionReady && !state.casting,
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
            if (state.casting) {
                CircularProgressIndicator(
                    modifier = Modifier
                        .size(15.dp)
                        .padding(end = 6.dp),
                    strokeWidth = 2.dp,
                    color = XuanshuColors.Muted,
                )
            }
            Text(
                text = stringResource(R.string.liuyao_cast_now),
                style = MaterialTheme.typography.labelLarge,
            )
        }

        Spacer(Modifier.weight(1f))

        TextButton(onClick = onBack, modifier = Modifier.padding(bottom = 12.dp)) {
            Text(
                text = stringResource(R.string.common_back),
                color = XuanshuColors.Weak,
                style = MaterialTheme.typography.labelMedium,
            )
        }
    }
}

@Composable
private fun PresetQuestions(onPick: (String) -> Unit) {
    val presets = listOf(
        stringResource(R.string.liuyao_preset_1),
        stringResource(R.string.liuyao_preset_2),
        stringResource(R.string.liuyao_preset_3),
    )
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = stringResource(R.string.liuyao_presets),
            style = MaterialTheme.typography.labelSmall,
            color = XuanshuColors.Weak,
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            presets.forEach { preset ->
                Surface(
                    onClick = { onPick(preset) },
                    color = XuanshuColors.Panel2,
                    border = BorderStroke(1.dp, XuanshuColors.LineSoft),
                    shape = RoundedCornerShape(9.dp),
                ) {
                    Text(
                        text = preset,
                        style = MaterialTheme.typography.labelMedium,
                        color = XuanshuColors.Text2,
                        modifier = Modifier.padding(horizontal = 11.dp, vertical = 7.dp),
                    )
                }
            }
        }
    }
}

/** 三枚铜钱：每摇一次点亮一枚，并轻微放大回弹。 */
@Composable
private fun CoinRow(shakeCount: Int) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(18.dp, Alignment.CenterHorizontally),
    ) {
        repeat(REQUIRED_SHAKES) { index ->
            val settled = index < shakeCount
            val scale by animateFloatAsState(
                targetValue = if (settled) 1f else 0.86f,
                animationSpec = tween(durationMillis = 220),
                label = "coin$index",
            )
            Box(
                modifier = Modifier
                    .size(58.dp)
                    .scale(scale)
                    .background(
                        color = if (settled) XuanshuColors.Gold.copy(alpha = 0.16f) else XuanshuColors.Panel2,
                        shape = CircleShape,
                    )
                    .border(
                        width = if (settled) 1.5.dp else 1.dp,
                        color = if (settled) XuanshuColors.Gold else XuanshuColors.Line,
                        shape = CircleShape,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = if (settled) "☯" else "·",
                    style = MaterialTheme.typography.headlineSmall,
                    color = if (settled) XuanshuColors.GoldBright else XuanshuColors.Weak,
                )
            }
        }
    }
}
