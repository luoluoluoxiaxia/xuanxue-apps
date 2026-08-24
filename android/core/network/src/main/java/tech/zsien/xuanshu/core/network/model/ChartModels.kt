package tech.zsien.xuanshu.core.network.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** 排盘请求。历法口径和排盘规则由服务端统一决定。 */
@Serializable
data class ChartRequest(
    val system: String = "bazi",
    val calendar: String = "solar",
    val year: Int,
    val month: Int,
    val day: Int,
    val hour: Int,
    val minute: Int,
    /** male / female。 */
    val gender: String,
    val location: String,
    @SerialName("as_of") val asOf: String? = null,
)

/** 排盘响应。客户端只解析公开契约中的展示字段，多余字段由 JSON 配置忽略。 */
@Serializable
data class ChartResponse(
    val chart: BaziChart = BaziChart(),
    @SerialName("pillars_detail") val pillarsDetail: PillarsDetail = PillarsDetail(),
    @SerialName("wuxing_count") val wuxingCount: Map<String, Int> = emptyMap(),
    @SerialName("month_command") val monthCommand: MonthCommand = MonthCommand(),
    @SerialName("xun_kong") val xunKong: String = "",
    @SerialName("tai_yuan") val taiYuan: String = "",
    @SerialName("chart_id") val chartId: Int = 0,
    @SerialName("profile_id") val profileId: Int = 0,
    @SerialName("profile_name") val profileName: String = "",
    @SerialName("analysis_date") val analysisDate: String = "",
)

@Serializable
data class BaziChart(
    val pillars: Pillars = Pillars(),
    @SerialName("day_master") val dayMaster: DayMaster = DayMaster(),
    val shengxiao: String = "",
)

@Serializable
data class Pillars(
    val year: String = "",
    val month: String = "",
    val day: String = "",
    val hour: String = "",
)

@Serializable
data class DayMaster(
    val stem: String = "",
    val element: String = "",
    @SerialName("yin_yang") val yinYang: String = "",
)

@Serializable
data class PillarsDetail(
    val year: PillarDetail = PillarDetail(),
    val month: PillarDetail = PillarDetail(),
    val day: PillarDetail = PillarDetail(),
    val hour: PillarDetail = PillarDetail(),
)

@Serializable
data class PillarDetail(
    val pillar: String = "",
    @SerialName("stem_ten_god") val stemTenGod: String = "",
    val hidden: List<HiddenStem> = emptyList(),
    @SerialName("di_shi") val diShi: String = "",
    @SerialName("na_yin") val naYin: String = "",
    @SerialName("xun_kong") val xunKong: String = "",
)

@Serializable
data class HiddenStem(
    val stem: String = "",
    @SerialName("ten_god") val tenGod: String = "",
    /** 本气 / 中气 / 余气。 */
    val qi: String = "",
    val exposed: Boolean = false,
)

@Serializable
data class MonthCommand(
    val branch: String = "",
    @SerialName("main_qi") val mainQi: String = "",
    @SerialName("hidden_stems") val hiddenStems: List<String> = emptyList(),
    val exposed: List<String> = emptyList(),
)
