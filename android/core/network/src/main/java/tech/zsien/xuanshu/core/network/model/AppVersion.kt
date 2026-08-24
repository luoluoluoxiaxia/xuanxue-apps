package tech.zsien.xuanshu.core.network.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * 启动时探测的版本闸门，对应后端 `/api/app/version`。
 *
 * 本地 versionCode 低于 [minSupportedVersionCode] 表示接口契约已不兼容，
 * 必须升级才能继续使用；仅低于 [latestVersionCode] 则只做非阻断提示。
 */
@Serializable
data class AppVersion(
    val platform: String = "android",
    @SerialName("latest_version_code") val latestVersionCode: Int = 1,
    @SerialName("min_supported_version_code") val minSupportedVersionCode: Int = 1,
    @SerialName("store_url") val storeUrl: String = "",
    val notice: String = "",
) {
    fun updateState(currentVersionCode: Int): UpdateState = when {
        currentVersionCode < minSupportedVersionCode -> UpdateState.REQUIRED
        currentVersionCode < latestVersionCode -> UpdateState.OPTIONAL
        else -> UpdateState.NONE
    }
}

enum class UpdateState { NONE, OPTIONAL, REQUIRED }
