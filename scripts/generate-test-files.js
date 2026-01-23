// Generate test files for long file truncation bug testing
const fs = require('fs');

function generateTestFile(lines, filename) {
  let content = `# Test File - ${lines} Lines\n\nThis is a test file with ${lines} lines to test long file rendering.\n\n`;
  
  for (let i = 5; i <= lines; i += 3) {
    content += `## Line ${i}\n\nContent line ${i}\n\n`;
  }
  
  content += `## Line ${lines} - END\n\n**This is the last line. If you can see this, the file is rendering completely!**\n`;
  
  fs.writeFileSync(`public/${filename}`, content);
  console.log(`Created ${filename} with ${lines} lines`);
}

// Generate test files
generateTestFile(500, 'test-500-lines.md');
generateTestFile(1000, 'test-1000-lines.md');
generateTestFile(10000, 'test-10000-lines.md');

console.log('All test files generated successfully!');
