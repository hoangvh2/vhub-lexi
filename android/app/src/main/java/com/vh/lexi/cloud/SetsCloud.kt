package com.vh.lexi.cloud

import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import com.google.firebase.storage.FirebaseStorage
import com.google.firebase.storage.StorageException
import com.google.firebase.storage.StorageMetadata
import com.vh.lexi.core.CloudMeta
import com.vh.lexi.core.MAX_SETS
import kotlinx.coroutines.tasks.await
import java.io.File

/**
 * Where Bộ đề live in the account (core/TestSetSync.kt has the layout; web: data/setscloud.ts). Every call goes to the
 * server; offline they fail and the next sync tries again.
 */
interface SetsCloud {
    /** The account's sets, from the server (never the cache: a missing document means "deleted elsewhere"). */
    suspend fun list(): List<CloudMeta>
    suspend fun putFile(id: String, path: String, file: File, contentType: String, onSent: (Long) -> Unit = {})
    /** Downloads into [into] (written whole, then moved in place). */
    suspend fun getFile(id: String, path: String, into: File)
    suspend fun putMeta(meta: CloudMeta)
    /** The document first (the set disappears from every device's list), then its files. */
    suspend fun remove(id: String, files: List<String>)
}

/** The bucket infra/storage.tf creates: named after the project, so no extra build setting is needed. */
fun bucketOf(projectId: String) = "gs://$projectId-lexi-testsets"

class FirebaseSetsCloud(private val uid: String, private val db: FirebaseFirestore, private val storage: FirebaseStorage) : SetsCloud {
    private fun col() = db.collection("users").document(uid).collection("testsets")
    private fun ref(id: String, path: String) = storage.reference.child("users/$uid/testsets/$id/$path")

    override suspend fun list(): List<CloudMeta> =
        col().limit(MAX_SETS.toLong()).get(Source.SERVER).await().documents.mapNotNull { d -> d.data?.let(::metaFrom) }

    override suspend fun putFile(id: String, path: String, file: File, contentType: String, onSent: (Long) -> Unit) {
        val task = ref(id, path).putFile(android.net.Uri.fromFile(file), StorageMetadata.Builder().setContentType(contentType).build())
        task.addOnProgressListener { onSent(it.bytesTransferred) }
        task.await()
    }

    override suspend fun getFile(id: String, path: String, into: File) {
        into.parentFile?.mkdirs()
        val tmp = File(into.parentFile, into.name + ".part")
        ref(id, path).getFile(tmp).await()
        if (!tmp.renameTo(into)) {
            into.delete()
            check(tmp.renameTo(into)) { "could not store $path" }
        }
    }

    override suspend fun putMeta(meta: CloudMeta) {
        col().document(meta.id).set(metaDoc(meta)).await()
    }

    override suspend fun remove(id: String, files: List<String>) {
        col().document(id).delete().await()
        for (f in files) {
            try {
                ref(id, f).delete().await()
            } catch (e: StorageException) {
                if (e.errorCode != StorageException.ERROR_OBJECT_NOT_FOUND) throw e
            }
        }
    }
}

/** The Firestore document, the same fields the web writes (firestore.rules.tmpl validTestSet). */
fun metaDoc(m: CloudMeta): Map<String, Any> = mapOf(
    "id" to m.id, "name" to m.name, "section" to m.section, "createdAt" to m.createdAt, "updatedAt" to m.updatedAt,
    "files" to m.files, "bytes" to m.bytes, "questions" to m.questions.toLong(), "state" to m.state,
)

fun metaFrom(d: Map<String, Any?>): CloudMeta? {
    val id = d["id"] as? String ?: return null
    return CloudMeta(
        id = id, name = d["name"] as? String ?: "Bộ đề", section = d["section"] as? String ?: "rc",
        createdAt = (d["createdAt"] as? Number)?.toLong() ?: 0, updatedAt = (d["updatedAt"] as? Number)?.toLong() ?: 0,
        files = (d["files"] as? List<*>)?.filterIsInstance<String>() ?: emptyList(), bytes = (d["bytes"] as? Number)?.toLong() ?: 0,
        questions = (d["questions"] as? Number)?.toInt() ?: 0, state = d["state"] as? String ?: "",
    )
}
