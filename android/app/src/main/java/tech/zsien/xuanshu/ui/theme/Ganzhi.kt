package tech.zsien.xuanshu.ui.theme

/**
 * 天干地支到五行的固定对照。
 *
 * 这是展示用的常量表，不是排盘逻辑——四柱、十神、藏干全部由服务端算好下发，
 * 客户端只负责把「庚」这个字染成金色。真理源仍在服务端，不存在双份口径。
 */
private val STEM_ELEMENT = mapOf(
    '甲' to "木", '乙' to "木",
    '丙' to "火", '丁' to "火",
    '戊' to "土", '己' to "土",
    '庚' to "金", '辛' to "金",
    '壬' to "水", '癸' to "水",
)

private val BRANCH_ELEMENT = mapOf(
    '寅' to "木", '卯' to "木",
    '巳' to "火", '午' to "火",
    '辰' to "土", '戌' to "土", '丑' to "土", '未' to "土",
    '申' to "金", '酉' to "金",
    '亥' to "水", '子' to "水",
)

/** 未知字符返回空串，调用方据此退回正文色。 */
fun elementOf(char: Char): String =
    STEM_ELEMENT[char] ?: BRANCH_ELEMENT[char] ?: ""
