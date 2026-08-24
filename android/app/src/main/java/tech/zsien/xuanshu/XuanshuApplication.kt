package tech.zsien.xuanshu

import android.app.Application
import tech.zsien.xuanshu.data.AppContainer

class XuanshuApplication : Application() {

    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
