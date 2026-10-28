package com.vh.lexi.core

enum class SyncState { OFF, LOADING, SYNCED, PENDING, OFFLINE, DENIED, ERROR }

/**
 * The sync pill, derived from Firestore snapshot metadata (port of CloudRepo.publish() in web/src/data/cloud.ts).
 *
 * The cards listener must be registered with MetadataChanges.INCLUDE: when the server acknowledges a write only
 * hasPendingWrites changes, and without it Firestore never calls the listener again, so PENDING would stay forever.
 */
class SyncStatus {
    var state = SyncState.OFF
        private set

    private var signedIn = false
    private var pendingWrites = false
    private var fromCache = true
    private var denied = false
    private var failed = false
    /** A failure stays visible for a while even though the rolled-back snapshot that follows looks healthy. */
    private var errorUntil = 0L

    fun start(): SyncState {
        signedIn = true
        pendingWrites = false
        fromCache = true
        denied = false
        failed = false
        errorUntil = 0
        state = SyncState.LOADING
        return state
    }

    fun stop(): SyncState {
        signedIn = false
        state = SyncState.OFF
        return state
    }

    fun onSnapshot(hasPendingWrites: Boolean, isFromCache: Boolean, now: Long): SyncState {
        pendingWrites = hasPendingWrites
        fromCache = isFromCache
        if (!isFromCache) failed = false
        return publish(now)
    }

    fun onError(permissionDenied: Boolean, now: Long): SyncState {
        if (permissionDenied) denied = true else failed = true
        errorUntil = now + ERROR_HOLD_MS
        return publish(now)
    }

    /** Recomputes the state, e.g. once [ERROR_HOLD_MS] has passed after an error. */
    fun publish(now: Long): SyncState {
        state = when {
            !signedIn -> SyncState.OFF
            denied -> SyncState.DENIED
            failed || now < errorUntil -> SyncState.ERROR
            pendingWrites -> SyncState.PENDING
            fromCache -> SyncState.OFFLINE
            else -> SyncState.SYNCED
        }
        return state
    }

    companion object {
        const val ERROR_HOLD_MS = 15_000L
    }
}
