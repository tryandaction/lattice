#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * 生成性能测试文档
 *
 * 用法:
 *   node scripts/generate-performance-test.js 2000
 *   node scripts/generate-performance-test.js 10000
 */

const fs = require('fs');
const path = require('path');

// 获取目标行数
const targetLines = parseInt(process.argv[2]) || 2000;
const outputFile = path.join(__dirname, '..', 'docs', 'tests', `performance-test-${targetLines}-lines.md`);

console.log(`生成 ${targetLines} 行性能测试文档...`);

// 生成内容
let content = `# Performance Test Document - ${targetLines} Lines

This document is automatically generated for performance testing.
It contains ${targetLines} lines with various Markdown elements.

**Generated at:** ${new Date().toISOString()}

---

`;

let currentLine = content.split('\n').length;

// 内容模板
const templates = {
  heading: (level, num) => `${'#'.repeat(level)} Heading ${level} - Section ${num}\n\n`,

  paragraph: (num) => `This is paragraph ${num}. It contains **bold text**, *italic text*, \`inline code\`, and a formula: $E=mc^2$. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n\n`,

  list: (num) => `- List item ${num}.1\n- List item ${num}.2 with **bold**\n- List item ${num}.3 with *italic*\n  - Nested item ${num}.3.1\n  - Nested item ${num}.3.2\n\n`,

  codeBlock: (num, lang) => `\`\`\`${lang}\n// Code block ${num}\nfunction example${num}() {\n  const data = [1, 2, 3, 4, 5];\n  return data.map(x => x * 2);\n}\n\nconst result = example${num}();\nconsole.log(result);\n\`\`\`\n\n`,

  table: (num) => `| Column 1 | Column 2 | Column 3 | Column 4 |\n|----------|----------|----------|----------|\n| Row ${num}.1 | **Bold** | *Italic* | \`code\` |\n| Row ${num}.2 | Data A | Data B | Data C |\n| Row ${num}.3 | $x^2$ | ~~strike~~ | ==highlight== |\n\n`,

  blockquote: (num) => `> This is blockquote ${num}.\n> It can span multiple lines.\n> And contain **formatted** text.\n\n`,

  horizontalRule: () => `---\n\n`,

  mathBlock: (num) => `$$\n\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n$$\n\nFormula ${num} demonstrates mathematical notation.\n\n`,
};

// 语言列表
const languages = ['javascript', 'python', 'typescript', 'rust', 'go', 'java'];
let langIndex = 0;

// 生成内容直到达到目标行数
let sectionNum = 1;
let elementNum = 1;

while (currentLine < targetLines) {
  const remaining = targetLines - currentLine;

  // 根据剩余行数选择合适的元素
  if (remaining > 100) {
    // 添加大型元素
    const elementType = elementNum % 8;

    switch (elementType) {
      case 0:
        content += templates.heading(2, sectionNum++);
        currentLine += 2;
        break;

      case 1:
        content += templates.codeBlock(elementNum, languages[langIndex++ % languages.length]);
        currentLine += 11;
        break;

      case 2:
        content += templates.table(elementNum);
        currentLine += 5;
        break;

      case 3:
        content += templates.paragraph(elementNum);
        currentLine += 2;
        break;

      case 4:
        content += templates.list(elementNum);
        currentLine += 6;
        break;

      case 5:
        content += templates.blockquote(elementNum);
        currentLine += 4;
        break;

      case 6:
        content += templates.mathBlock(elementNum);
        currentLine += 5;
        break;

      case 7:
        content += templates.horizontalRule();
        currentLine += 2;
        break;
    }

    elementNum++;
  } else {
    // 剩余行数不多，添加简单段落
    content += templates.paragraph(elementNum++);
    currentLine += 2;
  }
}

// 添加结尾
content += `\n---\n\n## Document Statistics\n\n`;
content += `- **Total Lines:** ${currentLine}\n`;
content += `- **Target Lines:** ${targetLines}\n`;
content += `- **Sections:** ${sectionNum}\n`;
content += `- **Elements:** ${elementNum}\n`;
content += `- **Generated:** ${new Date().toISOString()}\n`;

// 确保目录存在
const dir = path.dirname(outputFile);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

// 写入文件
fs.writeFileSync(outputFile, content, 'utf8');

console.log(`✅ 成功生成文档: ${outputFile}`);
console.log(`📊 实际行数: ${currentLine}`);
console.log(`📝 元素数量: ${elementNum}`);
