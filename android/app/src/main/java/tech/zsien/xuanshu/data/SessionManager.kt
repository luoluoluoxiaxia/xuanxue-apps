package tech.zsien.xuanshu.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicReference
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 原生会话令牌的唯一真理源。
 *
 * 磁盘上只保存 AES-GCM 密文；加密密钥由 Android Keystore 生成并保持不可导出。
 * OkHttp 拦截器从内存缓存同步读取，登录、恢复和退出负责更新安全存储。
 */
class SessionManager(context: Context) {

    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    private val cached = AtomicReference<String?>(null)

    fun currentToken(): String? = cached.get()

    fun isLoggedIn(): Boolean = !cached.get().isNullOrBlank()

    suspend fun restore(): String? = withContext(Dispatchers.IO) {
        val stored = preferences.getString(KEY_CIPHERTEXT, null)
        val token = stored?.let(::decryptOrClear)?.takeIf(String::isNotBlank)
        cached.set(token)
        token
    }

    suspend fun save(token: String) = withContext(Dispatchers.IO) {
        if (token.isBlank()) {
            clearStoredToken()
            cached.set(null)
            return@withContext
        }
        val encrypted = runCatching { encrypt(token) }.getOrElse { error ->
            resetKeyAndStorage()
            throw IllegalStateException("Unable to protect the session token", error)
        }
        preferences.edit().putString(KEY_CIPHERTEXT, encrypted).commit()
        cached.set(token)
    }

    suspend fun clear() = withContext(Dispatchers.IO) {
        clearStoredToken()
        cached.set(null)
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey(), SecureRandom())
        val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        val ciphertext = Base64.encodeToString(
            cipher.doFinal(value.toByteArray(Charsets.UTF_8)),
            Base64.NO_WRAP,
        )
        return "$iv:$ciphertext"
    }

    private fun decryptOrClear(value: String): String? = runCatching {
        val parts = value.split(':', limit = 2)
        require(parts.size == 2) { "Invalid encrypted token format" }
        val iv = Base64.decode(parts[0], Base64.NO_WRAP)
        val ciphertext = Base64.decode(parts[1], Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        cipher.doFinal(ciphertext).toString(Charsets.UTF_8)
    }.getOrElse {
        resetKeyAndStorage()
        null
    }

    private fun secretKey(): SecretKey {
        val keyStore = keyStore()
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER).run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build()
            )
            generateKey()
        }
    }

    private fun clearStoredToken() {
        preferences.edit().remove(KEY_CIPHERTEXT).commit()
    }

    private fun resetKeyAndStorage() {
        clearStoredToken()
        runCatching { keyStore().deleteEntry(KEY_ALIAS) }
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }

    private companion object {
        const val PREFERENCES_NAME = "secure_session"
        const val KEY_CIPHERTEXT = "session_token_ciphertext"
        const val KEY_ALIAS = "xuanshu_session_aes_v1"
        const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_BITS = 128
    }
}
