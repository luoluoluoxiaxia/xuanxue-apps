package tech.zsien.xuanshu.ui.liuyao

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import kotlin.math.sqrt

/**
 * 摇动检测。
 *
 * 注意：摇手机只是交互表现，**不参与随机**——卦象由服务端代摇产生。
 * 否则用户可以反复摇到自己想要的卦，占卜本身就不成立了。
 */
private const val SHAKE_G_THRESHOLD = 2.2f

/** 两次摇动之间的冷却，避免一次挥动被算成好几下。 */
private const val SHAKE_COOLDOWN_MS = 420L

@Composable
fun rememberShakeDetector(enabled: Boolean, onShake: () -> Unit) {
    val context = LocalContext.current
    val currentOnShake by rememberUpdatedState(onShake)

    DisposableEffect(enabled) {
        if (!enabled) return@DisposableEffect onDispose { }

        val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        val accelerometer = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        if (accelerometer == null) {
            // 模拟器或无加速度计的设备：静默降级，界面上的手动按钮仍可用。
            return@DisposableEffect onDispose { }
        }

        var lastShakeAt = 0L
        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                val (x, y, z) = Triple(event.values[0], event.values[1], event.values[2])
                val gForce = sqrt(x * x + y * y + z * z) / SensorManager.GRAVITY_EARTH
                val now = SystemClock.elapsedRealtime()
                if (gForce > SHAKE_G_THRESHOLD && now - lastShakeAt > SHAKE_COOLDOWN_MS) {
                    lastShakeAt = now
                    currentOnShake()
                }
            }

            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
        }

        sensorManager.registerListener(listener, accelerometer, SensorManager.SENSOR_DELAY_GAME)
        onDispose { sensorManager.unregisterListener(listener) }
    }
}
