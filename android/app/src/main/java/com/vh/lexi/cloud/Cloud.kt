package com.vh.lexi.cloud

import android.app.Activity
import android.content.Context
import android.util.Log
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.functions.FirebaseFunctions
import com.vh.lexi.BuildConfig
import com.vh.lexi.data.LexiData
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

/** Who is signed in. [Off]: this build has no Firebase settings (phone-only). */
sealed interface Account {
    data object Off : Account
    data object SignedOut : Account
    data class SignedIn(val uid: String, val email: String, val name: String) : Account
}

/** What the AI step returns for one word. */
data class Enriched(val vi: String, val en: String?, val examples: List<String>, val mnemonic: String?)

/**
 * The optional cloud side: Google sign-in, the two-way sync with the web app (same account) and the `enrich`
 * function. Without Firebase build settings nothing here starts and the app keeps working on the phone alone.
 */
class Cloud(private val context: Context, private val data: LexiData, private val scope: CoroutineScope) {
    val enabled: Boolean = listOf(
        BuildConfig.FIREBASE_API_KEY, BuildConfig.FIREBASE_APP_ID, BuildConfig.FIREBASE_PROJECT_ID,
        BuildConfig.FIREBASE_SENDER_ID, BuildConfig.FIREBASE_WEB_CLIENT_ID,
    ).all { it.isNotBlank() }

    private val firebase: FirebaseApp? = if (!enabled) null else try {
        FirebaseApp.getApps(context).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME } ?: FirebaseApp.initializeApp(
            context,
            FirebaseOptions.Builder()
                .setApiKey(BuildConfig.FIREBASE_API_KEY)
                .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                .build(),
        )
    } catch (e: Exception) {
        Log.e(TAG, "Firebase did not start", e)
        null
    }

    private val auth: FirebaseAuth? = firebase?.let { FirebaseAuth.getInstance(it) }
    private val db: FirebaseFirestore? = firebase?.let { FirebaseFirestore.getInstance(it) }
    private val functions: FirebaseFunctions? = firebase?.let { FirebaseFunctions.getInstance(it, BuildConfig.FUNCTIONS_REGION) }

    private val _account = MutableStateFlow<Account>(if (firebase == null) Account.Off else Account.SignedOut)
    val account: StateFlow<Account> = _account

    /** Something the person must know about the account (not allowed in, sign-in failed). */
    val problem = MutableStateFlow<String?>(null)

    val sync: CloudSync? = db?.let { CloudSync(it, data, scope, onDenied = ::denied) }

    init {
        auth?.addAuthStateListener { a ->
            val user = a.currentUser
            if (user == null) {
                sync?.stop()
                _account.value = Account.SignedOut
            } else if ((account.value as? Account.SignedIn)?.uid != user.uid) {
                _account.value = Account.SignedIn(user.uid, user.email.orEmpty(), user.displayName ?: user.email.orEmpty())
                sync?.start(user.uid)
            }
        }
    }

    /** Google sign-in with the phone's account picker. Returns a message for the person, or null (done or cancelled). */
    suspend fun signIn(activity: Activity): String? {
        val auth = auth ?: return "Bản cài này chưa cấu hình đồng bộ"
        return try {
            val option = GetSignInWithGoogleOption.Builder(BuildConfig.FIREBASE_WEB_CLIENT_ID).build()
            val result = CredentialManager.create(activity).getCredential(activity, GetCredentialRequest.Builder().addCredentialOption(option).build())
            val credential = result.credential
            if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                return "Không nhận được tài khoản Google"
            }
            val google = GoogleIdTokenCredential.createFrom(credential.data)
            auth.signInWithCredential(GoogleAuthProvider.getCredential(google.idToken, null)).await()
            problem.value = null
            null
        } catch (_: GetCredentialCancellationException) {
            null
        } catch (_: NoCredentialException) {
            "Máy chưa có tài khoản Google. Thêm tài khoản trong Cài đặt của điện thoại rồi thử lại"
        } catch (e: GetCredentialException) {
            Log.w(TAG, "Credential Manager failed", e)
            "Đăng nhập Google không thành công (${e.type.substringAfterLast('.')})"
        } catch (e: Exception) {
            Log.w(TAG, "Firebase sign-in failed", e)
            "Đăng nhập không thành công, kiểm tra mạng rồi thử lại"
        }
    }

    /** Stops syncing; the study data stays on this phone. */
    suspend fun signOut() {
        auth?.signOut()
        runCatching { CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest()) }
    }

    /** The account is not on the allowlist: the server refuses everything, so sign out and say why. */
    private fun denied() {
        problem.value = "Tài khoản này chưa được cấp quyền. Thêm Gmail của bạn vào allowed_emails rồi deploy lại"
        scope.launch { signOut() }
    }

    /** Vietnamese meaning, examples and a memory tip from the `enrich` Cloud Function. Throws with a readable message. */
    suspend fun enrich(word: String, pos: String?, en: String?, examples: List<String>): Enriched {
        val fn = functions ?: error("Chưa kết nối tài khoản")
        try {
            val payload = hashMapOf<String, Any?>("word" to word, "pos" to pos, "en" to en, "examples" to examples)
            val res = fn.getHttpsCallable("enrich").call(payload).await().data as? Map<*, *> ?: error("Phản hồi không hợp lệ")
            return Enriched(
                vi = res["vi"] as? String ?: "",
                en = res["en"] as? String,
                examples = (res["examples"] as? List<*>)?.filterIsInstance<String>() ?: emptyList(),
                mnemonic = res["mnemonic"] as? String,
            )
        } catch (e: com.google.firebase.functions.FirebaseFunctionsException) {
            throw IllegalStateException(
                when (e.code) {
                    com.google.firebase.functions.FirebaseFunctionsException.Code.RESOURCE_EXHAUSTED -> "Hết lượt AI hôm nay. Bạn vẫn có thể nhập tay."
                    com.google.firebase.functions.FirebaseFunctionsException.Code.UNAUTHENTICATED -> "Cần đăng nhập để dùng AI."
                    else -> e.message ?: "Không gọi được AI."
                },
            )
        }
    }

    companion object {
        private const val TAG = "LexiCloud"
    }
}
