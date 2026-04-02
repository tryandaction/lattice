import { describe, expect, it } from "vitest";
import { normalizeExecutionText } from "@/lib/runner/text-utils";

describe("normalizeExecutionText", () => {
  it("保留正常 unicode 文本", () => {
    expect(normalizeExecutionText("print('hello 世界')")).toBe("print('hello 世界')");
  });

  it("将 cp1252 风格的孤立低位 surrogate 转成可执行字符", () => {
    expect(normalizeExecutionText("print('\udc92test\udc93')")).toBe("print('’test“')");
  });

  it("将其它孤立 surrogate 替换为 replacement char", () => {
    expect(normalizeExecutionText("a\ud800b\udc00c")).toBe("a�b�c");
  });
});

