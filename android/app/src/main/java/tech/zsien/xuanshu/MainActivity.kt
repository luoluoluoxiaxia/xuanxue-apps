package tech.zsien.xuanshu

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import tech.zsien.xuanshu.ui.XuanshuApp
import tech.zsien.xuanshu.ui.theme.XuanshuColors
import tech.zsien.xuanshu.ui.theme.XuanshuTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            XuanshuTheme {
                Surface(
                    color = XuanshuColors.Bg,
                    modifier = Modifier.fillMaxSize(),
                ) {
                    XuanshuApp()
                }
            }
        }
    }
}
