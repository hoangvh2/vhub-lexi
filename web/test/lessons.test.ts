import { describe, expect, it } from "vitest";
import { isLesson, lessonName, lessonTitle } from "../src/lib/lessons.ts";

describe("lesson names", () => {
  it("turns importer tags into a number and a readable title", () => {
    expect(lessonName("05-conferences")).toEqual({ num: "05", title: "Conferences" });
    expect(lessonName("04-business-planning")).toEqual({ num: "04", title: "Business planning" });
    expect(lessonName("lesson-12")).toEqual({ num: "12", title: "Bài 12" });
    expect(lessonName("Unit 3 Travel")).toEqual({ num: "03", title: "Travel" });
    expect(lessonName("7_office_procedures")).toEqual({ num: "07", title: "Office procedures" });
    expect(lessonName("ielts")).toEqual({ num: null, title: "Ielts" });
    expect(lessonTitle("46-doctor-s-office")).toBe("46 · Doctor's office");
  });
  it("tells lessons from topic tags", () => {
    expect(isLesson("05-conferences")).toBe(true);
    expect(isLesson("lesson-2")).toBe(true);
    expect(isLesson("ielts")).toBe(false);
  });
});
