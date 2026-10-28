package com.vh.lexi.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

/**
 * One generic document table: (collection, id) -> JSON. New note types or collections need no migration,
 * and the stored JSON is exactly what is synced to Firestore.
 */
@Entity(tableName = "docs", primaryKeys = ["col", "id"])
data class DocRow(val col: String, val id: String, val json: String)

@Dao
interface DocDao {
    @Query("SELECT * FROM docs WHERE col = :col")
    fun observe(col: String): Flow<List<DocRow>>

    @Query("SELECT * FROM docs WHERE col = :col")
    suspend fun all(col: String): List<DocRow>

    @Query("SELECT * FROM docs WHERE col = :col AND id = :id")
    suspend fun get(col: String, id: String): DocRow?

    @Upsert
    suspend fun upsert(rows: List<DocRow>)

    @Query("DELETE FROM docs WHERE col = :col AND id IN (:ids)")
    suspend fun delete(col: String, ids: List<String>)

    @Query("DELETE FROM docs")
    suspend fun clear()
}

@Database(entities = [DocRow::class], version = 1, exportSchema = false)
abstract class LexiDb : RoomDatabase() {
    abstract fun docs(): DocDao

    companion object {
        fun open(context: Context): LexiDb = Room.databaseBuilder(context, LexiDb::class.java, "lexi.db").build()
    }
}
