package tech.zsien.xuanshu.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * 「玄枢·观星罗盘」的配色，逐值取自 Web 端 static/style.css 的 :root 变量。
 *
 * 不要在这里发明新色值——两端视觉必须一致，改动应先落到 Web 的设计变量。
 */
object XuanshuColors {
    val Bg = Color(0xFF07070B)
    val Panel = Color(0xFF0B0B10)
    val Panel2 = Color(0xFF0D0D13)
    val Panel3 = Color(0xFF111118)

    val Gold = Color(0xFFD4AF5D)
    val GoldBright = Color(0xFFEFD597)
    val GoldPale = Color(0xFFF6E7BD)
    val GoldDim = Color(0xFFC9B584)
    val GoldDark = Color(0xFF9C7A35)

    val Text = Color(0xFFF0EADA)
    val Text2 = Color(0xFFD6CFBA)
    val Muted = Color(0xFFA9A28E)
    val Weak = Color(0xFF6C665A)

    /** 金色描边：分隔线与卡片边框都用它，透明度决定层级。 */
    val Line = Color(0xFFD4AF5D).copy(alpha = 0.22f)
    val LineSoft = Color(0xFFD4AF5D).copy(alpha = 0.14f)
    val LineStrong = Color(0xFFEFD597).copy(alpha = 0.56f)

    val Danger = Color(0xFFE89A80)
    val DangerDeep = Color(0xFFBE4A33)

    /** 五行色。命盘里干支、藏干、五行统计都按这个上色。 */
    val ElementWood = Color(0xFF8FCB9B)
    val ElementFire = Color(0xFFE89A80)
    val ElementEarth = Color(0xFFDBB975)
    val ElementMetal = Color(0xFFD8D2C0)
    val ElementWater = Color(0xFF8FB4D0)
}

/** 把「木火土金水」映射到对应颜色；未知值退回正文色，不要抛异常。 */
fun elementColor(element: String): Color = when (element) {
    "木" -> XuanshuColors.ElementWood
    "火" -> XuanshuColors.ElementFire
    "土" -> XuanshuColors.ElementEarth
    "金" -> XuanshuColors.ElementMetal
    "水" -> XuanshuColors.ElementWater
    else -> XuanshuColors.Text2
}
