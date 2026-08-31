package tech.zsien.xuanshu.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import tech.zsien.xuanshu.ui.archive.ArchiveScreen
import tech.zsien.xuanshu.ui.archive.ArchiveViewModel
import tech.zsien.xuanshu.ui.auth.AuthUiState
import tech.zsien.xuanshu.ui.auth.AuthViewModel
import tech.zsien.xuanshu.ui.auth.LoginScreen
import tech.zsien.xuanshu.ui.chart.BirthInputScreen
import tech.zsien.xuanshu.ui.chart.ChartScreen
import tech.zsien.xuanshu.ui.chart.ChartViewModel
import tech.zsien.xuanshu.ui.community.CommunityScreen
import tech.zsien.xuanshu.ui.community.CommunityViewModel
import tech.zsien.xuanshu.ui.home.HomeScreen
import tech.zsien.xuanshu.ui.liuyao.CastScreen
import tech.zsien.xuanshu.ui.liuyao.GuaScreen
import tech.zsien.xuanshu.ui.liuyao.LiuyaoViewModel
import tech.zsien.xuanshu.ui.theme.XuanshuColors

@Composable
fun XuanshuApp(
    viewModel: AuthViewModel = viewModel(factory = AuthViewModel.Factory),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    when {
        // 恢复本地令牌期间显示加载，避免已登录用户先看到一帧登录页。
        state.restoring -> Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator(color = XuanshuColors.Gold)
        }

        state.loggedIn -> SignedInFlow(authState = state, onLogout = viewModel::logout)

        else -> LoginScreen(
            state = state,
            onLogin = viewModel::login,
            onLoginWithCode = viewModel::loginWithCode,
            onSendVerificationCode = viewModel::sendVerificationCode,
            onRegister = viewModel::register,
        )
    }
}

private enum class Route { HOME, BAZI, LIUYAO, ARCHIVE, COMMUNITY }

/**
 * 登录后的流程。
 *
 * 屏数还少，用状态切换即可；等档案、社区等屏加进来再迁到 Navigation 3
 * （依赖已就位），届时这里的分支会换成 NavDisplay 的 back stack。
 * 系统返回键必须能用——Android 用户对此的期望是硬性的。
 */
@Composable
private fun SignedInFlow(
    authState: AuthUiState,
    onLogout: () -> Unit,
    chartViewModel: ChartViewModel = viewModel(factory = ChartViewModel.Factory),
    liuyaoViewModel: LiuyaoViewModel = viewModel(factory = LiuyaoViewModel.Factory),
    archiveViewModel: ArchiveViewModel = viewModel(factory = ArchiveViewModel.Factory),
    communityViewModel: CommunityViewModel = viewModel(factory = CommunityViewModel.Factory),
) {
    var route by rememberSaveable { mutableStateOf(Route.HOME) }

    BackHandler(enabled = route != Route.HOME) {
        // 档案内部有「阅读 → 历史 → 列表」三层，先让它自己退，退无可退才回首页
        if (route == Route.ARCHIVE && archiveViewModel.back()) return@BackHandler
        if (route == Route.COMMUNITY && communityViewModel.back()) return@BackHandler
        route = Route.HOME
    }

    when (route) {
        Route.HOME -> HomeScreen(
            state = authState,
            onLogout = onLogout,
            onStartBazi = {
                chartViewModel.reset()
                route = Route.BAZI
            },
            onStartLiuyao = {
                liuyaoViewModel.reset()
                route = Route.LIUYAO
            },
            onOpenArchive = {
                archiveViewModel.refresh()
                route = Route.ARCHIVE
            },
            onOpenCommunity = { route = Route.COMMUNITY },
        )

        Route.BAZI -> {
            val chartState by chartViewModel.state.collectAsStateWithLifecycle()
            if (chartState.chart != null) {
                ChartScreen(
                    state = chartState,
                    onInterpret = chartViewModel::interpret,
                    onBack = { chartViewModel.reset() },
                )
            } else {
                BirthInputScreen(
                    state = chartState,
                    onFormChange = chartViewModel::updateForm,
                    onSubmit = chartViewModel::castChart,
                )
            }
        }

        Route.ARCHIVE -> {
            val archiveState by archiveViewModel.state.collectAsStateWithLifecycle()
            ArchiveScreen(
                state = archiveState,
                onOpenProfile = archiveViewModel::openProfile,
                onOpenReading = archiveViewModel::openReading,
                onBack = { if (!archiveViewModel.back()) route = Route.HOME },
            )
        }

        Route.COMMUNITY -> {
            val communityState by communityViewModel.state.collectAsStateWithLifecycle()
            CommunityScreen(
                state = communityState,
                onOpen = communityViewModel::open,
                onLoadMore = communityViewModel::loadMore,
                onBack = { if (!communityViewModel.back()) route = Route.HOME },
            )
        }

        Route.LIUYAO -> {
            val liuyaoState by liuyaoViewModel.state.collectAsStateWithLifecycle()
            if (liuyaoState.chart != null) {
                GuaScreen(
                    state = liuyaoState,
                    onInterpret = liuyaoViewModel::interpret,
                    onBack = { liuyaoViewModel.reset() },
                )
            } else {
                CastScreen(
                    state = liuyaoState,
                    onQuestionChange = liuyaoViewModel::updateQuestion,
                    onShake = liuyaoViewModel::onShake,
                    onCast = liuyaoViewModel::cast,
                    onBack = { route = Route.HOME },
                )
            }
        }
    }
}
