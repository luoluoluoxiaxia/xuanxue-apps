package tech.zsien.xuanshu.ui.home

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import tech.zsien.xuanshu.R
import tech.zsien.xuanshu.ui.auth.AuthUiState
import tech.zsien.xuanshu.ui.theme.XuanshuColors

@Composable
fun HomeScreen(
    state: AuthUiState,
    onLogout: () -> Unit,
    onStartBazi: () -> Unit,
    onStartLiuyao: () -> Unit,
    onOpenArchive: () -> Unit,
    onOpenCommunity: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(XuanshuColors.Bg)
            .safeDrawingPadding()
            .padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Spacer(Modifier.height(90.dp))

        Text(
            text = stringResource(R.string.app_name),
            style = MaterialTheme.typography.displaySmall,
            color = XuanshuColors.GoldBright,
        )

        state.quota?.let { quota ->
            Surface(
                color = XuanshuColors.Panel2,
                border = BorderStroke(1.dp, XuanshuColors.Line),
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier.padding(18.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        text = stringResource(R.string.home_greeting),
                        style = MaterialTheme.typography.labelMedium,
                        color = XuanshuColors.Weak,
                    )
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(
                            text = quota.remaining.toString(),
                            style = MaterialTheme.typography.displaySmall,
                            color = XuanshuColors.Gold,
                        )
                        Text(
                            text = " / ${quota.total}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = XuanshuColors.Muted,
                            modifier = Modifier.padding(bottom = 7.dp),
                        )
                    }
                    state.wallet?.let { wallet ->
                        Text(
                            text = stringResource(
                                R.string.home_account_credits,
                                wallet.balance,
                            ),
                            style = MaterialTheme.typography.titleMedium,
                            color = XuanshuColors.Gold,
                        )
                        Text(
                            text = stringResource(R.string.home_account_credits_hint),
                            style = MaterialTheme.typography.bodySmall,
                            color = XuanshuColors.Muted,
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(4.dp))

        Button(
            onClick = onStartBazi,
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = XuanshuColors.Gold,
                contentColor = XuanshuColors.Bg,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
        ) {
            Text(
                text = stringResource(R.string.home_start_bazi),
                style = MaterialTheme.typography.labelLarge,
            )
        }

        androidx.compose.material3.OutlinedButton(
            onClick = onStartLiuyao,
            shape = RoundedCornerShape(12.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, XuanshuColors.Line),
            colors = androidx.compose.material3.ButtonDefaults.outlinedButtonColors(
                contentColor = XuanshuColors.GoldDim,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
        ) {
            Text(
                text = stringResource(R.string.home_start_liuyao),
                style = MaterialTheme.typography.labelLarge,
            )
        }

        TextButton(onClick = onOpenCommunity, modifier = Modifier.fillMaxWidth()) {
            Text(
                text = stringResource(R.string.home_community),
                color = XuanshuColors.GoldDim,
                style = MaterialTheme.typography.labelMedium,
            )
        }

        TextButton(onClick = onOpenArchive, modifier = Modifier.fillMaxWidth()) {
            Text(
                text = stringResource(R.string.home_archive),
                color = XuanshuColors.GoldDim,
                style = MaterialTheme.typography.labelMedium,
            )
        }

        Spacer(Modifier.weight(1f))

        state.user?.let { user ->
            Text(
                text = stringResource(R.string.home_account, user.email),
                style = MaterialTheme.typography.labelSmall,
                color = XuanshuColors.Weak,
            )
        }
        TextButton(
            onClick = onLogout,
            modifier = Modifier.padding(bottom = 12.dp),
        ) {
            Text(
                text = stringResource(R.string.auth_logout),
                color = XuanshuColors.Weak,
                style = MaterialTheme.typography.labelMedium,
            )
        }
    }
}
