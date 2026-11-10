package com.vh.lexi.util

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.util.Base64
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.text.TextPosition
import com.vh.lexi.core.PdfPage
import com.vh.lexi.core.TextItem
import com.vh.lexi.core.layoutText
import com.vh.lexi.core.pdfPage
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.math.roundToInt

/**
 * The PDF of a Bộ đề, read on the phone (web: lib/pdf.ts with pdf.js). Text comes from PdfBox (positions, so the same
 * layoutText puts two columns in reading order); pages are drawn by Android's PdfRenderer (PDFium), which decodes
 * copier scans (CCITT, JBIG2) itself. Blocking: call off the main thread.
 */
object Pdf {
    /** A whole book scanned is often 100+ MB; it is copied once to the cache and read page by page. */
    const val MAX_BYTES = 150L * 1024 * 1024

    /** Longest side of a rendered page: enough for the model to read 9-pt print, small enough for the function's limit. */
    private const val RENDER_PX = 1600

    class TooLarge : Exception()

    /** Copies the picked file to the cache (the picker's stream can be read once only; PdfRenderer needs a seekable file). */
    fun copyToCache(context: Context, uri: Uri): File {
        val out = File(context.cacheDir, "testset-import.pdf")
        val input = context.contentResolver.openInputStream(uri) ?: error("cannot open")
        input.use { i ->
            out.outputStream().use { o ->
                val buf = ByteArray(1 shl 16)
                var total = 0L
                while (true) {
                    val n = i.read(buf)
                    if (n < 0) break
                    total += n
                    if (total > MAX_BYTES) throw TooLarge()
                    o.write(buf, 0, n)
                }
            }
        }
        return out
    }

    /** Positions of each word on the page, in PDF units with y up (as pdf.js gives them). */
    private class ItemStripper : PDFTextStripper() {
        val items = mutableListOf<TextItem>()
        var height = 0f

        override fun writeString(text: String, positions: MutableList<TextPosition>) {
            if (positions.isEmpty()) return
            val first = positions.first()
            val last = positions.last()
            val h = positions.maxOf { it.heightDir }.takeIf { it > 0 } ?: 10f
            items += TextItem(text, first.xDirAdj.toDouble(), (height - first.yDirAdj).toDouble(), (last.xDirAdj + last.widthDirAdj - first.xDirAdj).toDouble(), h.toDouble())
        }
    }

    /** Text of every page in reading order, and whether the page has to be read as a picture. */
    fun readPages(context: Context, file: File, onPage: (n: Int, of: Int) -> Unit = { _, _ -> }): List<PdfPage> {
        PDFBoxResourceLoader.init(context.applicationContext)
        PDDocument.load(file, MemoryUsageSetting.setupTempFileOnly()).use { doc ->
            val count = doc.numberOfPages
            val out = ArrayList<PdfPage>(count)
            for (n in 1..count) {
                val page = doc.getPage(n - 1)
                val box = page.cropBox
                val turned = (page.rotation / 90) % 2 != 0
                val width = if (turned) box.height else box.width
                val s = ItemStripper().apply {
                    startPage = n
                    endPage = n
                    height = if (turned) box.width else box.height
                }
                // A page whose text cannot be read (a broken font) is treated as a scan, not as a failed file.
                val text = runCatching { s.getText(doc); layoutText(s.items, width.toDouble()) }.getOrDefault("")
                out += pdfPage(n, text)
                onPage(n, count)
            }
            return out
        }
    }

    /** Page [n] drawn [px] on its longest side, turned a further [turn] degrees (a book fed into the copier upside down). */
    fun renderBitmap(file: File, n: Int, turn: Int = 0, px: Int = RENDER_PX): Bitmap = synchronized(this) {
        ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
            PdfRenderer(fd).use { r ->
                r.openPage(n - 1).use { p ->
                    val scale = px.toFloat() / maxOf(p.width, p.height)
                    val bmp = Bitmap.createBitmap(maxOf(1, (p.width * scale).roundToInt()), maxOf(1, (p.height * scale).roundToInt()), Bitmap.Config.ARGB_8888)
                    bmp.eraseColor(Color.WHITE)
                    p.render(bmp, null, Matrix().apply { setScale(scale, scale) }, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    if (turn % 360 == 0) bmp
                    else Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(turn.toFloat()) }, true).also { bmp.recycle() }
                }
            }
        }
    }

    /** JPEG bytes of a page, under the function's 1.4 MB base64 limit. */
    fun renderJpeg(file: File, n: Int, turn: Int = 0, px: Int = RENDER_PX, qualities: List<Int> = listOf(80, 65, 50)): ByteArray {
        val bmp = renderBitmap(file, n, turn, px)
        try {
            for (q in qualities) {
                val out = ByteArrayOutputStream()
                bmp.compress(Bitmap.CompressFormat.JPEG, q, out)
                if (out.size() * 4 / 3 <= 1_400_000) return out.toByteArray()
            }
        } finally {
            bmp.recycle()
        }
        error("Trang quá lớn để đọc")
    }

    /** A page as base64 JPEG (no data: prefix), as the `extract-questions` function takes it. */
    fun renderBase64(file: File, n: Int, turn: Int = 0): String = Base64.encodeToString(renderJpeg(file, n, turn), Base64.NO_WRAP)
}
