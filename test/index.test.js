import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getToday,
  cleanText,
  getNodeText,
  extractTodaysNotices
} from "../src/index.js";

describe("NESTS Notice Monitor Unit Tests", () => {
  describe("cleanText", () => {
    it("should clean whitespace and trim string", () => {
      assert.strictEqual(cleanText("  hello   world \n "), "hello world");
      assert.strictEqual(cleanText(null), "");
      assert.strictEqual(cleanText("test"), "test");
    });
  });

  describe("getToday", () => {
    it("should return today date in DD MMM YYYY format", () => {
      const today = getToday();
      assert.match(today, /^\d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}$/);
    });
  });

  describe("extractTodaysNotices", () => {
    const sampleHtml = `
      <!DOCTYPE HTML>
      <html>
        <body>
          <table>
            <tr>
              <td>1</td>
              <td><a href="showfile.php?id=101">Notice Regarding TGT Exam</a></td>
              <td>250 KB</td>
              <td>10 Sep 2026</td>
            </tr>
            <tr>
              <td>2</td>
              <td><a href="showfile.php?id=102">Older Notice for PGT</a></td>
              <td>150 KB</td>
              <td>05 Sep 2026</td>
            </tr>
          </table>
        </body>
      </html>
    `;

    it("should extract notices matching the provided date", () => {
      const results = extractTodaysNotices(sampleHtml, "10 Sep 2026");
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].title, "Notice Regarding TGT Exam");
      assert.strictEqual(
        results[0].url,
        "https://nests.tribal.gov.in/showfile.php?id=101"
      );
      assert.strictEqual(results[0].date, "10 Sep 2026");
    });

    it("should return empty array if no notices match today date", () => {
      const results = extractTodaysNotices(sampleHtml, "01 Jan 2020");
      assert.strictEqual(results.length, 0);
    });
  });
});
