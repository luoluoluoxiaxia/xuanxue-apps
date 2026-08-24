package tech.zsien.xuanshu.ui.liuyao

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * 三枚铜钱先后落桌的触感。
 *
 * 用分次波形而不是系统预设的单次反馈——「摇一卦」和「点一下按钮」的手感差别
 * 就在这里，也是原生相对 WebView 拿得到的东西（网页拿不到细粒度震动波形）。
 */
fun Context.playCoinDropHaptic() {
    val vibrator = vibratorOrNull() ?: return
    if (!vibrator.hasVibrator()) return

    // 三下落地，间隔递增、力度递减，模拟铜钱先后停住
    val timings = longArrayOf(0, 26, 70, 22, 96, 18)
    val amplitudes = intArrayOf(0, 180, 0, 140, 0, 105)
    vibrator.vibrate(VibrationEffect.createWaveform(timings, amplitudes, -1))
}

/** 单枚铜钱落定，用于每次摇动的即时反馈。 */
fun Context.playSingleCoinHaptic() {
    val vibrator = vibratorOrNull() ?: return
    if (!vibrator.hasVibrator()) return
    vibrator.vibrate(VibrationEffect.createOneShot(24, 165))
}

private fun Context.vibratorOrNull(): Vibrator? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }
