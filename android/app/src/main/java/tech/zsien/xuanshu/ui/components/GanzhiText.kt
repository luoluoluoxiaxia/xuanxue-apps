package tech.zsien.xuanshu.ui.components

import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import tech.zsien.xuanshu.ui.theme.XuanshuColors
import tech.zsien.xuanshu.ui.theme.elementColor
import tech.zsien.xuanshu.ui.theme.elementOf

/**
 * 干支文本：逐字按五行上色。
 *
 * 「庚午」里庚属金、午属火，两个字颜色不同——这是命理排盘的常规呈现，
 * 一眼就能看出盘面的五行分布，比统一白字信息量大得多。
 */
@Composable
fun GanzhiText(
    ganzhi: String,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalTextStyle.current,
) {
    Text(
        text = colorizeGanzhi(ganzhi),
        style = style,
        modifier = modifier,
    )
}

@Composable
private fun colorizeGanzhi(ganzhi: String): AnnotatedString = buildAnnotatedString {
    ganzhi.forEach { char ->
        val element = elementOf(char)
        val color = if (element.isEmpty()) XuanshuColors.Text else elementColor(element)
        withStyle(SpanStyle(color = color)) { append(char) }
    }
}
