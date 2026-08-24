package tech.zsien.xuanshu.data

import kotlinx.coroutines.flow.Flow
import tech.zsien.xuanshu.core.network.InterpretStream
import tech.zsien.xuanshu.core.network.XuanshuApi
import tech.zsien.xuanshu.core.network.apiCall
import tech.zsien.xuanshu.core.network.model.ChartRequest
import tech.zsien.xuanshu.core.network.model.ChartResponse
import tech.zsien.xuanshu.core.network.model.InterpretRequest
import tech.zsien.xuanshu.core.network.model.InterpretTask
import tech.zsien.xuanshu.core.network.model.LiuyaoCastRequest
import tech.zsien.xuanshu.core.network.model.CommunityComments
import tech.zsien.xuanshu.core.network.model.CommunityFeed
import tech.zsien.xuanshu.core.network.model.CommunityPost
import tech.zsien.xuanshu.core.network.model.InterpretHistoryItem
import tech.zsien.xuanshu.core.network.model.LiuyaoChart
import tech.zsien.xuanshu.core.network.model.ProfileItem

class ChartRepository(
    private val api: XuanshuApi,
    private val stream: InterpretStream,
) {

    suspend fun createChart(request: ChartRequest): Result<ChartResponse> =
        apiCall { api.chart(request) }

    suspend fun castLiuyao(request: LiuyaoCastRequest): Result<LiuyaoChart> =
        apiCall { api.castLiuyao(request) }

    suspend fun startInterpret(request: InterpretRequest): Result<InterpretTask> =
        apiCall { api.interpret(request) }

    /** 流式订阅；断线会自动重连，服务端推全量快照所以重连即续上。 */
    fun observeTask(taskId: String): Flow<InterpretTask> = stream.observe(taskId)

    suspend fun communityFeed(cursor: String? = null): Result<CommunityFeed> =
        apiCall { api.communityFeed(cursor) }

    suspend fun communityPost(slug: String): Result<CommunityPost> =
        apiCall { api.communityPost(slug) }

    suspend fun communityComments(slug: String): Result<CommunityComments> =
        apiCall { api.communityComments(slug) }

    suspend fun profiles(): Result<List<ProfileItem>> = apiCall { api.profiles() }

    suspend fun interpretations(profileId: Int): Result<List<InterpretHistoryItem>> =
        apiCall { api.interpretations(profileId) }

    /** 回到前台时用它拉一次当前进度，不必等下一帧 SSE。 */
    suspend fun fetchTask(taskId: String): Result<InterpretTask> =
        apiCall { api.interpretTask(taskId) }
}
