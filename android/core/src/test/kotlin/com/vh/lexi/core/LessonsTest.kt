package com.vh.lexi.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Same cases as web/test/lessons.test.ts. */
class LessonsTest {
    @Test
    fun `turns importer tags into a number and a readable title`() {
        assertEquals(LessonName("05", "Conferences"), lessonName("05-conferences"))
        assertEquals(LessonName("04", "Business planning"), lessonName("04-business-planning"))
        assertEquals(LessonName("12", "Bài 12"), lessonName("lesson-12"))
        assertEquals(LessonName("03", "Travel"), lessonName("Unit 3 Travel"))
        assertEquals(LessonName("07", "Office procedures"), lessonName("7_office_procedures"))
        assertEquals(LessonName(null, "Ielts"), lessonName("ielts"))
        assertEquals("46 · Doctor's office", lessonTitle("46-doctor-s-office"))
    }

    @Test
    fun `tells lessons from topic tags`() {
        assertTrue(isLesson("05-conferences"))
        assertTrue(isLesson("lesson-2"))
        assertFalse(isLesson("ielts"))
    }
}
