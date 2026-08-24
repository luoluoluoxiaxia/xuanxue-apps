package tech.zsien.xuanshu.ui.chart

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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import tech.zsien.xuanshu.R
import tech.zsien.xuanshu.ui.theme.XuanshuColors

@Composable
fun BirthInputScreen(
    state: ChartUiState,
    onFormChange: (BirthForm) -> Unit,
    onSubmit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val form = state.form

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(XuanshuColors.Bg)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Spacer(Modifier.height(80.dp))

        Text(
            text = stringResource(R.string.chart_title),
            style = MaterialTheme.typography.headlineMedium,
            color = XuanshuColors.GoldBright,
        )
        Text(
            text = stringResource(R.string.chart_subtitle),
            style = MaterialTheme.typography.bodySmall,
            color = XuanshuColors.Muted,
        )

        Spacer(Modifier.height(6.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            NumberField(form.year, stringResource(R.string.chart_year), Modifier.weight(1.5f)) {
                onFormChange(form.copy(year = it))
            }
            NumberField(form.month, stringResource(R.string.chart_month), Modifier.weight(1f)) {
                onFormChange(form.copy(month = it))
            }
            NumberField(form.day, stringResource(R.string.chart_day), Modifier.weight(1f)) {
                onFormChange(form.copy(day = it))
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            NumberField(form.hour, stringResource(R.string.chart_hour), Modifier.weight(1f)) {
                onFormChange(form.copy(hour = it))
            }
            NumberField(form.minute, stringResource(R.string.chart_minute), Modifier.weight(1f)) {
                onFormChange(form.copy(minute = it))
            }
            Spacer(Modifier.weight(1.5f))
        }

        Row(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.chart_gender),
                style = MaterialTheme.typography.labelMedium,
                color = XuanshuColors.Weak,
            )
            GenderChip(form.gender == "male", stringResource(R.string.chart_gender_male)) {
                onFormChange(form.copy(gender = "male"))
            }
            GenderChip(form.gender == "female", stringResource(R.string.chart_gender_female)) {
                onFormChange(form.copy(gender = "female"))
            }
        }

        OutlinedTextField(
            value = form.location,
            onValueChange = { onFormChange(form.copy(location = it)) },
            label = { Text(stringResource(R.string.chart_location)) },
            singleLine = true,
            shape = RoundedCornerShape(12.dp),
            colors = goldFieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )

        Text(
            text = state.error.orEmpty(),
            style = MaterialTheme.typography.bodySmall,
            color = XuanshuColors.Danger,
            modifier = Modifier.height(20.dp),
        )

        Button(
            onClick = onSubmit,
            enabled = !state.casting,
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = XuanshuColors.Gold,
                contentColor = XuanshuColors.Bg,
                disabledContainerColor = XuanshuColors.GoldDark.copy(alpha = 0.35f),
                disabledContentColor = XuanshuColors.Muted,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
        ) {
            if (state.casting) {
                CircularProgressIndicator(
                    modifier = Modifier
                        .size(15.dp)
                        .padding(end = 6.dp),
                    strokeWidth = 2.dp,
                    color = XuanshuColors.Muted,
                )
            }
            Text(
                text = stringResource(R.string.chart_cast),
                style = MaterialTheme.typography.labelLarge,
            )
        }
    }
}

@Composable
private fun GenderChip(selected: Boolean, label: String, onClick: () -> Unit) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label, style = MaterialTheme.typography.labelMedium) },
        shape = RoundedCornerShape(10.dp),
        colors = FilterChipDefaults.filterChipColors(
            containerColor = XuanshuColors.Panel2,
            labelColor = XuanshuColors.Muted,
            selectedContainerColor = XuanshuColors.Gold.copy(alpha = 0.16f),
            selectedLabelColor = XuanshuColors.GoldBright,
        ),
        border = FilterChipDefaults.filterChipBorder(
            enabled = true,
            selected = selected,
            borderColor = XuanshuColors.Line,
            selectedBorderColor = XuanshuColors.Gold,
        ),
    )
}

@Composable
private fun NumberField(
    value: String,
    label: String,
    modifier: Modifier = Modifier,
    onValueChange: (String) -> Unit,
) {
    OutlinedTextField(
        value = value,
        // 只留数字，避免用户粘进非法字符后到服务端才报错
        onValueChange = { input -> onValueChange(input.filter(Char::isDigit).take(4)) },
        label = { Text(label, style = MaterialTheme.typography.labelSmall) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        shape = RoundedCornerShape(12.dp),
        colors = goldFieldColors(),
        modifier = modifier,
    )
}

@Composable
private fun goldFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = XuanshuColors.Gold,
    unfocusedBorderColor = XuanshuColors.Line,
    focusedLabelColor = XuanshuColors.GoldDim,
    unfocusedLabelColor = XuanshuColors.Weak,
    cursorColor = XuanshuColors.Gold,
    focusedTextColor = XuanshuColors.Text,
    unfocusedTextColor = XuanshuColors.Text,
)
