package tech.zsien.xuanshu.core.network.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * 六爻起卦请求。
 *
 * method=coins 由服务端代摇（随机数在服务端产生，客户端摇手机只是交互表现，
 * 不参与随机——否则客户端可以反复摇到想要的卦，卦就不成立了）。
 */
@Serializable
data class LiuyaoCastRequest(
    val system: String = "liuyao",
    val method: String = "coins",
    val question: String,
    val visibility: String = "private",
    @SerialName("public_consent") val publicConsent: Boolean = false,
    @SerialName("as_of") val asOf: String? = null,
)

@Serializable
data class LiuyaoChart(
    val system: String = "liuyao",
    val method: String = "",
    val question: String = "",
    @SerialName("cast_time") val castTime: CastTime = CastTime(),
    /** 月建，判断爻的旺衰。 */
    @SerialName("month_jian") val monthJian: String = "",
    /** 日辰。 */
    @SerialName("day_chen") val dayChen: String = "",
    @SerialName("xun_kong") val xunKong: String = "",
    @SerialName("ben_gua") val benGua: GuaInfo = GuaInfo(),
    @SerialName("bian_gua") val bianGua: GuaInfo? = null,
    @SerialName("shi_yao") val shiYao: Int = 0,
    @SerialName("ying_yao") val yingYao: Int = 0,
    @SerialName("dong_yao") val dongYao: List<Int> = emptyList(),
    /** 自下而上，pos 1 为初爻。 */
    val yaos: List<Yao> = emptyList(),
    @SerialName("chart_id") val chartId: Int = 0,
    @SerialName("profile_id") val profileId: Int = 0,
)

/** 起卦时刻：既有公历时间，也有当时的四柱，断卦要看月建日辰。 */
@Serializable
data class CastTime(
    val solar: String = "",
    val date: String = "",
    val time: String = "",
    @SerialName("year_gz") val yearGz: String = "",
    @SerialName("month_gz") val monthGz: String = "",
    @SerialName("day_gz") val dayGz: String = "",
    @SerialName("hour_gz") val hourGz: String = "",
    @SerialName("hour_zhi") val hourZhi: String = "",
    @SerialName("hour_range") val hourRange: String = "",
)

@Serializable
data class GuaInfo(
    val name: String = "",
    val palace: String = "",
    /** 游魂 / 归魂等标记，没有则为空。 */
    @SerialName("palace_label") val palaceLabel: String = "",
    @SerialName("palace_wuxing") val palaceWuxing: String = "",
)

@Serializable
data class Yao(
    val pos: Int = 0,
    @SerialName("yin_yang") val yinYang: String = "",
    val moving: Boolean = false,
    /** 老阴 / 少阳 等。老阴老阳即动爻。 */
    @SerialName("old_young") val oldYoung: String = "",
    val najia: String = "",
    val wuxing: String = "",
    /** 六亲：父母 / 兄弟 / 子孙 / 妻财 / 官鬼。 */
    @SerialName("liu_qin") val liuQin: String = "",
    /** 六神：青龙 / 朱雀 / 勾陈 / 螣蛇 / 白虎 / 玄武。 */
    @SerialName("liu_shen") val liuShen: String = "",
    val shi: Boolean = false,
    val ying: Boolean = false,
    val kong: Boolean = false,
    @SerialName("fu_shen") val fuShen: FuShen? = null,
    val bian: BianYao? = null,
) {
    val isYang: Boolean get() = yinYang == "阳"
}

/** 伏神：本卦缺失的六亲藏在此爻之下。 */
@Serializable
data class FuShen(
    @SerialName("liu_qin") val liuQin: String = "",
    val najia: String = "",
    val wuxing: String = "",
)

@Serializable
data class BianYao(
    val najia: String = "",
    val wuxing: String = "",
    @SerialName("liu_qin") val liuQin: String = "",
)
