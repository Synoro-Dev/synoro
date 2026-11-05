import { describe, expect, it } from "bun:test";

import { faqPage, serializeJsonLd } from "./structured-data";

describe("structured data", () => {
  it("marks up exactly the questions it is given", () => {
    const page = faqPage([{ q: "Вопрос?", a: "Ответ." }]);
    expect(page.mainEntity).toEqual([
      {
        "@type": "Question",
        name: "Вопрос?",
        acceptedAnswer: { "@type": "Answer", text: "Ответ." },
      },
    ]);
  });

  it("can't close its script tag early", () => {
    const json = serializeJsonLd({ text: "</script><script>alert(1)" });
    expect(json).not.toContain("<");
    expect(JSON.parse(json).text).toBe("</script><script>alert(1)");
  });
});
