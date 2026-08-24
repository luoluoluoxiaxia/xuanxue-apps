package tech.zsien.xuanshu.core.network.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * 私人档案。八字与六爻共用一份列表，靠 [system] 区分，
 * 因此 [summary] 里的字段两种情况下不完全相同，缺失的一律给默认值。
 */
@Serializable
data class ProfileItem(
    val id: Int = 0,
    @SerialName("chart_id") val chartId: Int = 0,
    val system: String = "bazi",
    val name: String = "",
    val visibility: String = "",
    @SerialName("is_default") val isDefault: Boolean = false,
    val summary: ProfileSummary = ProfileSummary(),
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("history_count") val historyCount: Int = 0,
) {
    val isBazi: Boolean get() = system == "bazi"
}

@Serializable
data class ProfileSummary(
    val pillars: Pillars = Pillars(),
    val gender: String = "",
    val shengxiao: String = "",
    /** 六爻档案用：卦名。 */
    @SerialName("gua_name") val guaName: String = "",
    val question: String = "",
)

/** 一条留档的解读正文。 */
@Serializable
data class InterpretHistoryItem(
    val id: Int = 0,
    @SerialName("chart_id") val chartId: Int = 0,
    @SerialName("task_id") val taskId: String = "",
    val scenario: String = "",
    val topic: String = "",
    val question: String = "",
    val answer: String = "",
    @SerialName("created_at") val createdAt: String = "",
)
