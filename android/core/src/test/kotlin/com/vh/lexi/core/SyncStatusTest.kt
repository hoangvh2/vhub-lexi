package com.vh.lexi.core

import kotlin.test.Test
import kotlin.test.assertEquals

class SyncStatusTest {
    @Test
    fun `adding a word shows pending, then synced once the server acknowledges it`() {
        val s = SyncStatus()
        assertEquals(SyncState.LOADING, s.start())
        assertEquals(SyncState.OFFLINE, s.onSnapshot(hasPendingWrites = false, isFromCache = true, now = 0))
        assertEquals(SyncState.SYNCED, s.onSnapshot(hasPendingWrites = false, isFromCache = false, now = 1))
        // New word: the local write fires the listener with hasPendingWrites...
        assertEquals(SyncState.PENDING, s.onSnapshot(hasPendingWrites = true, isFromCache = false, now = 2))
        // ...and the acknowledgement is a metadata-only snapshot (delivered with MetadataChanges.INCLUDE).
        assertEquals(SyncState.SYNCED, s.onSnapshot(hasPendingWrites = false, isFromCache = false, now = 3))
    }

    @Test
    fun `a failed write shows an error for a while, then clears once the server answers`() {
        val s = SyncStatus()
        s.start()
        s.onSnapshot(hasPendingWrites = false, isFromCache = false, now = 0)
        assertEquals(SyncState.ERROR, s.onError(permissionDenied = false, now = 1_000))
        // Firestore rolls the write back: healthy-looking server snapshot, error still on screen.
        assertEquals(SyncState.ERROR, s.onSnapshot(hasPendingWrites = false, isFromCache = false, now = 1_100))
        assertEquals(SyncState.SYNCED, s.publish(now = 1_000 + SyncStatus.ERROR_HOLD_MS))
    }

    @Test
    fun `an error while offline clears on the next server snapshot after the hold`() {
        val s = SyncStatus()
        s.start()
        s.onError(permissionDenied = false, now = 0)
        assertEquals(SyncState.ERROR, s.onSnapshot(hasPendingWrites = false, isFromCache = true, now = SyncStatus.ERROR_HOLD_MS))
        assertEquals(SyncState.SYNCED, s.onSnapshot(hasPendingWrites = false, isFromCache = false, now = SyncStatus.ERROR_HOLD_MS + 1))
    }

    @Test
    fun `denied wins and sign-out turns sync off`() {
        val s = SyncStatus()
        s.start()
        assertEquals(SyncState.DENIED, s.onError(permissionDenied = true, now = 0))
        assertEquals(SyncState.DENIED, s.onSnapshot(hasPendingWrites = false, isFromCache = false, now = 60_000))
        assertEquals(SyncState.OFF, s.stop())
        assertEquals(SyncState.LOADING, s.start())
    }
}
