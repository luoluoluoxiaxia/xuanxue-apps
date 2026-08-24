package tech.zsien.xuanshu.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import tech.zsien.xuanshu.R
import tech.zsien.xuanshu.ui.theme.XuanshuColors

@Composable
fun LoginScreen(
    state: AuthUiState,
    onLogin: (String, String) -> Unit,
    onRegister: (String, String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // 旋转屏幕或进程重建后不该把已输入的邮箱丢掉。
    var email by rememberSaveable { mutableStateOf("") }
    // 密码只保留在当前进程内，不能进入可恢复的 saved state。
    var password by remember { mutableStateOf("") }
    var localError by remember { mutableStateOf<String?>(null) }

    fun validated(action: (String, String) -> Unit) {
        localError = null
        when {
            email.isBlank() -> localError = "EMAIL"
            password.isBlank() -> localError = "PASSWORD"
            else -> {
                action(email, password)
                password = ""
            }
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(XuanshuColors.Bg)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 32.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        // 上方大留白，让品牌字有呼吸感；不做垂直居中，否则键盘弹出会整体跳动。
        Spacer(Modifier.height(120.dp))

        Text(
            text = stringResource(R.string.app_name),
            style = MaterialTheme.typography.displaySmall,
            color = XuanshuColors.GoldBright,
        )
        Text(
            text = stringResource(R.string.auth_subtitle),
            style = MaterialTheme.typography.bodyMedium,
            color = XuanshuColors.Muted,
        )

        Spacer(Modifier.height(18.dp))

        GoldTextField(
            value = email,
            onValueChange = { email = it },
            label = stringResource(R.string.auth_email),
            enabled = !state.submitting,
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Email,
                imeAction = ImeAction.Next,
            ),
        )

        GoldTextField(
            value = password,
            onValueChange = { password = it },
            label = stringResource(R.string.auth_password),
            enabled = !state.submitting,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Password,
                imeAction = ImeAction.Done,
            ),
        )

        val message = when (localError) {
            "EMAIL" -> stringResource(R.string.auth_email_required)
            "PASSWORD" -> stringResource(R.string.auth_password_required)
            else -> state.error
        }
        // 固定高度占位，出错时按钮不会被顶下去
        Text(
            text = message.orEmpty(),
            style = MaterialTheme.typography.bodySmall,
            color = XuanshuColors.Danger,
            modifier = Modifier.height(20.dp),
        )

        Button(
            onClick = { validated(onLogin) },
            enabled = !state.submitting,
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
            if (state.submitting) {
                CircularProgressIndicator(
                    modifier = Modifier
                        .size(15.dp)
                        .padding(end = 6.dp),
                    strokeWidth = 2.dp,
                    color = XuanshuColors.Muted,
                )
            }
            Text(
                text = stringResource(R.string.auth_login),
                style = MaterialTheme.typography.labelLarge,
            )
        }

        TextButton(
            onClick = { validated(onRegister) },
            enabled = !state.submitting,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                text = stringResource(R.string.auth_register),
                color = XuanshuColors.GoldDim,
                style = MaterialTheme.typography.labelMedium,
            )
        }
    }
}

@Composable
private fun GoldTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    enabled: Boolean,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    visualTransformation: androidx.compose.ui.text.input.VisualTransformation =
        androidx.compose.ui.text.input.VisualTransformation.None,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = true,
        enabled = enabled,
        visualTransformation = visualTransformation,
        keyboardOptions = keyboardOptions,
        shape = RoundedCornerShape(12.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = XuanshuColors.Gold,
            unfocusedBorderColor = XuanshuColors.Line,
            focusedLabelColor = XuanshuColors.GoldDim,
            unfocusedLabelColor = XuanshuColors.Weak,
            cursorColor = XuanshuColors.Gold,
            focusedTextColor = XuanshuColors.Text,
            unfocusedTextColor = XuanshuColors.Text,
        ),
        modifier = Modifier.fillMaxWidth(),
    )
}
