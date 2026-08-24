package tech.zsien.xuanshu.core.network.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** 公开卦帖列表。游标翻页，热门排序不支持游标。 */
@Serializable
data class CommunityFeed(
    val items: List<CommunityPost> = emptyList(),
    @SerialName("next_cursor") val nextCursor: String? = null,
)

/**
 * 公开卦帖。
 *
 * 列表接口不带 answer（省流量），详情接口才有；两处共用这个模型，
 * 缺省值保证列表场景不会因为少字段而解析失败。
 */
@Serializable
data class CommunityPost(
    val slug: String = "",
    val status: String = "",
    val title: String = "",
    val question: String = "",
    @SerialName("question_type_label") val questionTypeLabel: String = "",
    @SerialName("comment_count") val commentCount: Int = 0,
    @SerialName("like_count") val likeCount: Int = 0,
    @SerialName("view_count") val viewCount: Int = 0,
    @SerialName("published_at") val publishedAt: String? = null,
    @SerialName("ai_disclosure") val aiDisclosure: String = "",
    @SerialName("comments_enabled") val commentsEnabled: Boolean = false,
    val answer: String = "",
)

@Serializable
data class CommunityComments(
    val items: List<CommunityComment> = emptyList(),
)

@Serializable
data class CommunityComment(
    val id: Int = 0,
    val body: String = "",
    @SerialName("display_name") val displayName: String = "",
    @SerialName("created_at") val createdAt: String = "",
)
