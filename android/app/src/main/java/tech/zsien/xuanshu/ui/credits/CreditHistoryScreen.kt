package tech.zsien.xuanshu.ui.credits

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import tech.zsien.xuanshu.R
import tech.zsien.xuanshu.core.network.model.CreditActivityItem
import tech.zsien.xuanshu.core.network.model.PaymentOrderItem
import tech.zsien.xuanshu.ui.theme.XuanshuColors

@Composable
fun CreditHistoryScreen(
    state: CreditHistoryUiState,
    onBack: () -> Unit,
    onTab: (CreditHistoryTab) -> Unit,
    onFilter: (String) -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onRetry: () -> Unit,
) {
    Scaffold(containerColor = XuanshuColors.Bg) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onBack) {
                    Text(stringResource(R.string.common_back), color = XuanshuColors.Gold)
                }
                Text(
                    text = stringResource(R.string.credits_title),
                    style = MaterialTheme.typography.headlineSmall,
                    color = XuanshuColors.Text,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = state.tab == CreditHistoryTab.ACTIVITY,
                    onClick = { onTab(CreditHistoryTab.ACTIVITY) },
                    label = { Text(stringResource(R.string.credits_activity)) },
                )
                FilterChip(
                    selected = state.tab == CreditHistoryTab.ORDERS,
                    onClick = { onTab(CreditHistoryTab.ORDERS) },
                    label = { Text(stringResource(R.string.credits_orders)) },
                )
            }

            if (state.tab == CreditHistoryTab.ACTIVITY) {
                state.activity?.summary?.let { summary ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        SummaryCell(
                            label = stringResource(R.string.credits_balance),
                            value = summary.accountBalance,
                            modifier = Modifier.weight(1f),
                        )
                        SummaryCell(
                            label = stringResource(R.string.credits_received),
                            value = summary.lifetimeCredited,
                            modifier = Modifier.weight(1f),
                        )
                        SummaryCell(
                            label = stringResource(R.string.credits_answers),
                            value = summary.answerCount,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }

            FilterRow(state = state, onFilter = onFilter)

            when {
                state.loading && state.activity == null && state.orders == null -> {
                    Column(
                        modifier = Modifier.fillMaxWidth().weight(1f),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        CircularProgressIndicator(color = XuanshuColors.Gold)
                    }
                }
                state.error != null -> {
                    Column(
                        modifier = Modifier.fillMaxWidth().weight(1f),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text(state.error, color = XuanshuColors.Danger)
                        TextButton(onClick = onRetry) {
                            Text(stringResource(R.string.common_retry), color = XuanshuColors.Gold)
                        }
                    }
                }
                else -> HistoryList(state = state, modifier = Modifier.weight(1f))
            }

            if (state.pageCount > 1) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedButton(onClick = onPrevious, enabled = state.page > 1) {
                        Text(stringResource(R.string.credits_previous))
                    }
                    Text(
                        text = "${state.page} / ${state.pageCount}",
                        color = XuanshuColors.Muted,
                        style = MaterialTheme.typography.labelSmall,
                    )
                    Button(
                        onClick = onNext,
                        enabled = state.page < state.pageCount,
                        colors = ButtonDefaults.buttonColors(containerColor = XuanshuColors.Gold),
                    ) {
                        Text(stringResource(R.string.credits_next), color = XuanshuColors.Bg)
                    }
                }
            }
        }
    }
}

@Composable
private fun SummaryCell(label: String, value: Int, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = XuanshuColors.Panel2),
        border = BorderStroke(1.dp, XuanshuColors.Line),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(label, color = XuanshuColors.Muted, style = MaterialTheme.typography.labelSmall)
            Text(
                value.toString(),
                color = XuanshuColors.Gold,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun FilterRow(state: CreditHistoryUiState, onFilter: (String) -> Unit) {
    val choices = if (state.tab == CreditHistoryTab.ACTIVITY) {
        listOf("all" to R.string.credits_all, "credit" to R.string.credits_received, "usage" to R.string.credits_spent)
    } else {
        listOf("all" to R.string.credits_all, "paid" to R.string.credits_paid, "pending" to R.string.credits_pending, "expired" to R.string.credits_expired)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        choices.forEach { (value, label) ->
            FilterChip(
                selected = state.filter == value,
                onClick = { onFilter(value) },
                label = { Text(stringResource(label)) },
            )
        }
    }
}

@Composable
private fun HistoryList(state: CreditHistoryUiState, modifier: Modifier = Modifier) {
    val empty = if (state.tab == CreditHistoryTab.ACTIVITY) {
        state.activity?.items.isNullOrEmpty()
    } else {
        state.orders?.items.isNullOrEmpty()
    }
    if (empty) {
        Column(
            modifier = modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(stringResource(R.string.credits_empty), color = XuanshuColors.Muted)
        }
        return
    }
    LazyColumn(modifier = modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (state.tab == CreditHistoryTab.ACTIVITY) {
            items(state.activity?.items.orEmpty(), key = { it.id }) { item -> ActivityCard(item) }
        } else {
            items(state.orders?.items.orEmpty(), key = { it.orderId }) { item -> OrderCard(item) }
        }
    }
}

@Composable
private fun ActivityCard(item: CreditActivityItem) {
    HistoryCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(item.title, color = XuanshuColors.Text, style = MaterialTheme.typography.titleSmall)
                Text(item.description, color = XuanshuColors.Muted, style = MaterialTheme.typography.bodySmall)
                Text(
                    text = stringResource(R.string.credits_balance_after, item.balanceAfter),
                    color = XuanshuColors.Weak,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(
                    text = if (item.amount > 0) "+${item.amount}" else item.amount.toString(),
                    color = if (item.amount > 0) XuanshuColors.Gold else XuanshuColors.Text2,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                Text(item.createdAt.replace("T", " ").take(16), color = XuanshuColors.Weak, style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

@Composable
private fun OrderCard(item: PaymentOrderItem) {
    val status = when (item.status) {
        "paid" -> stringResource(R.string.credits_paid)
        "expired" -> stringResource(R.string.credits_expired)
        else -> stringResource(R.string.credits_pending)
    }
    HistoryCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("${item.credits} ${stringResource(R.string.credits_unit)}", color = XuanshuColors.Text)
                Text("${item.currency.uppercase()} ${"%.2f".format(item.amountTotal / 100.0)}", color = XuanshuColors.Muted)
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(status, color = if (item.status == "paid") XuanshuColors.ElementWood else XuanshuColors.GoldDim)
                Text(item.createdAt.replace("T", " ").take(16), color = XuanshuColors.Weak, style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

@Composable
private fun HistoryCard(content: @Composable () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = XuanshuColors.Panel2),
        border = BorderStroke(1.dp, XuanshuColors.LineSoft),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(Modifier.padding(14.dp)) { content() }
    }
}
