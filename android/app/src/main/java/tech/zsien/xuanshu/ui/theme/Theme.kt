package tech.zsien.xuanshu.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * 只有深色一套。玄枢的调性就是夜观星象，不提供浅色主题，
 * 也不用 Material You 动态取色——那会把黑金洗成系统壁纸的颜色。
 */
private val XuanshuColorScheme = darkColorScheme(
    primary = XuanshuColors.Gold,
    onPrimary = XuanshuColors.Bg,
    primaryContainer = XuanshuColors.GoldDark,
    onPrimaryContainer = XuanshuColors.GoldPale,
    secondary = XuanshuColors.GoldDim,
    onSecondary = XuanshuColors.Bg,
    background = XuanshuColors.Bg,
    onBackground = XuanshuColors.Text,
    surface = XuanshuColors.Panel,
    onSurface = XuanshuColors.Text,
    surfaceVariant = XuanshuColors.Panel3,
    onSurfaceVariant = XuanshuColors.Muted,
    outline = XuanshuColors.Line,
    outlineVariant = XuanshuColors.LineSoft,
    error = XuanshuColors.Danger,
    onError = XuanshuColors.Bg,
)

/**
 * 干支、卦名这类「术语字」用衬线，正文用无衬线——与 Web 端
 * --serif / --sans 的分工一致。系统中文衬线会回退到 Noto Serif CJK。
 */
private val Serif = FontFamily.Serif

private val XuanshuTypography = Typography(
    displaySmall = TextStyle(
        fontFamily = Serif,
        fontSize = 34.sp,
        lineHeight = 42.sp,
        fontWeight = FontWeight.Medium,
    ),
    headlineMedium = TextStyle(
        fontFamily = Serif,
        fontSize = 24.sp,
        lineHeight = 32.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 0.5.sp,
    ),
    headlineSmall = TextStyle(
        fontFamily = Serif,
        fontSize = 20.sp,
        lineHeight = 28.sp,
        fontWeight = FontWeight.Medium,
    ),
    titleMedium = TextStyle(
        fontSize = 15.sp,
        lineHeight = 22.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 1.sp,
    ),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 26.sp),
    // 解读正文很长，行高给足，长时间阅读才不累。
    bodyMedium = TextStyle(fontSize = 15.sp, lineHeight = 25.sp),
    bodySmall = TextStyle(fontSize = 13.sp, lineHeight = 20.sp),
    labelLarge = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.8.sp),
    labelMedium = TextStyle(fontSize = 12.sp, letterSpacing = 0.5.sp),
    labelSmall = TextStyle(fontSize = 11.sp, letterSpacing = 0.4.sp),
)

@Composable
fun XuanshuTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = XuanshuColorScheme,
        typography = XuanshuTypography,
        content = content,
    )
}
