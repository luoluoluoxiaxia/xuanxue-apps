package tech.zsien.xuanshu.core.network

import tech.zsien.xuanshu.core.network.model.AccountResponse
import tech.zsien.xuanshu.core.network.model.AppVersion
import tech.zsien.xuanshu.core.network.model.ChartRequest
import tech.zsien.xuanshu.core.network.model.ChartResponse
import tech.zsien.xuanshu.core.network.model.CreditActivityPage
import tech.zsien.xuanshu.core.network.model.InterpretRequest
import tech.zsien.xuanshu.core.network.model.InterpretTask
import tech.zsien.xuanshu.core.network.model.InviteCodeResponse
import tech.zsien.xuanshu.core.network.model.LiuyaoCastRequest
import tech.zsien.xuanshu.core.network.model.LiuyaoChart
import tech.zsien.xuanshu.core.network.model.CommunityComments
import tech.zsien.xuanshu.core.network.model.CommunityFeed
import tech.zsien.xuanshu.core.network.model.CommunityPost
import tech.zsien.xuanshu.core.network.model.InterpretHistoryItem
import tech.zsien.xuanshu.core.network.model.LoginRequest
import tech.zsien.xuanshu.core.network.model.ProfileItem
import tech.zsien.xuanshu.core.network.model.PaymentOrderPage
import tech.zsien.xuanshu.core.network.model.OkResponse
import tech.zsien.xuanshu.core.network.model.RegisterRequest
import tech.zsien.xuanshu.core.network.model.VerificationCodeRequest
import tech.zsien.xuanshu.core.network.model.VerificationCodeResponse
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * 玄枢后端的 REST 接口。
 *
 * 流式解读不在这里——SSE 走 [okhttp3.OkHttpClient] 上的 EventSource，
 * 与本接口共享同一个 client（连接池、拦截器、网络埋点因此保持统一）。
 */
interface XuanshuApi {

    @GET("api/app/version")
    suspend fun appVersion(): AppVersion

    @GET("api/auth/me")
    suspend fun me(): AccountResponse

    @POST("api/auth/code")
    suspend fun requestVerificationCode(@Body body: VerificationCodeRequest): VerificationCodeResponse

    @GET("api/auth/invite-code")
    suspend fun inviteCode(): InviteCodeResponse

    @POST("api/auth/register")
    suspend fun register(@Body body: RegisterRequest): AccountResponse

    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): AccountResponse

    @POST("api/auth/logout")
    suspend fun logout(): OkResponse

    @GET("api/billing/activity")
    suspend fun creditActivity(
        @Query("page") page: Int = 1,
        @Query("kind") kind: String = "all",
    ): CreditActivityPage

    @GET("api/billing/orders")
    suspend fun paymentOrders(
        @Query("page") page: Int = 1,
        @Query("status") status: String = "all",
    ): PaymentOrderPage

    @POST("api/chart")
    suspend fun chart(@Body body: ChartRequest): ChartResponse

    /** 六爻与八字共用 /api/chart，靠 system 字段区分，响应结构完全不同。 */
    @POST("api/chart")
    suspend fun castLiuyao(@Body body: LiuyaoCastRequest): LiuyaoChart

    @POST("api/interpret")
    suspend fun interpret(@Body body: InterpretRequest): InterpretTask

    /** 八字与六爻社区，无需登录即可浏览。 */
    @GET("api/community/posts")
    suspend fun communityFeed(@Query("cursor") cursor: String? = null): CommunityFeed

    @GET("api/community/posts/{slug}")
    suspend fun communityPost(@Path("slug") slug: String): CommunityPost

    @GET("api/community/posts/{slug}/comments")
    suspend fun communityComments(@Path("slug") slug: String): CommunityComments

    /** 私人档案列表，八字与六爻混在一起，按 system 区分。 */
    @GET("api/profiles")
    suspend fun profiles(): List<ProfileItem>

    @GET("api/profiles/{pid}/interpretations")
    suspend fun interpretations(@Path("pid") profileId: Int): List<InterpretHistoryItem>

    /** SSE 断开后用它拉回当前进度；服务端推的是全量快照，拿到即续上。 */
    @GET("api/interpret/tasks/{taskId}")
    suspend fun interpretTask(@Path("taskId") taskId: String): InterpretTask
}
