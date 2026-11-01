package com.vh.lexi.util

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import java.io.ByteArrayOutputStream

/** Screenshots shrink on the phone before they are sent (web/src/lib/image.ts does the same): about 2000 px on the long edge, JPEG. */
object Images {
    private const val MAX_EDGE = 2000
    private const val QUALITY = 85

    private fun bounds(context: Context, uri: Uri): Pair<Int, Int>? {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, o) }
        return if (o.outWidth > 0 && o.outHeight > 0) o.outWidth to o.outHeight else null
    }

    private fun decode(context: Context, uri: Uri, maxEdge: Int): Bitmap? {
        val (w, h) = bounds(context, uri) ?: return null
        var sample = 1
        while (maxOf(w, h) / (sample * 2) >= maxEdge) sample *= 2
        val o = BitmapFactory.Options().apply { inSampleSize = sample }
        val bmp = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, o) } ?: return null
        val k = minOf(1f, maxEdge.toFloat() / maxOf(bmp.width, bmp.height))
        if (k >= 1f) return bmp
        val scaled = Bitmap.createScaledBitmap(bmp, maxOf(1, (bmp.width * k).toInt()), maxOf(1, (bmp.height * k).toInt()), true)
        if (scaled !== bmp) bmp.recycle()
        return scaled
    }

    /** Base64 JPEG without the data: prefix, or null when the file is not an image. Blocking: call off the main thread. */
    fun encode(context: Context, uri: Uri): String? = runCatching {
        val bmp = decode(context, uri, MAX_EDGE) ?: return null
        val out = ByteArrayOutputStream()
        // A PNG with transparency would turn black as JPEG: flatten it on white first.
        val flat = Bitmap.createBitmap(bmp.width, bmp.height, Bitmap.Config.ARGB_8888)
        android.graphics.Canvas(flat).apply { drawColor(android.graphics.Color.WHITE); drawBitmap(bmp, 0f, 0f, null) }
        flat.compress(Bitmap.CompressFormat.JPEG, QUALITY, out)
        bmp.recycle(); flat.recycle()
        Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }.getOrNull()

    /** A small preview for the list of chosen images. Blocking. */
    fun thumbnail(context: Context, uri: Uri, edge: Int = 160): Bitmap? = runCatching { decode(context, uri, edge) }.getOrNull()
}
