import fs from 'fs';
import path from 'path';

function walk(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.next', '.git', 'out'].includes(entry.name)) walk(full, results);
    } else if (entry.name.match(/\.(tsx|ts)$/) && !entry.name.includes('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

const files = walk('src');
const issues = [];

for (const file of files) {
  if (file.includes('test') || file.includes('spec')) continue;
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const depMatch = line.match(/\},\s*\[([^\]]*)\]\s*\)/);
    if (!depMatch) continue;
    const deps = depMatch[1];

    let effectStart = -1;
    for (let j = i; j >= Math.max(0, i - 60); j--) {
      if (lines[j].includes('useEffect(')) { effectStart = j; break; }
    }
    if (effectStart === -1) continue;

    const body = lines.slice(effectStart, i).join('\n');
    const setterMatches = [...body.matchAll(/\bset([A-Z]\w*)\s*\(/g)];
    for (const m of setterMatches) {
      const stateName = m[1][0].toLowerCase() + m[1].slice(1);
      if (new RegExp('\\b' + stateName + '\\b').test(deps)) {
        issues.push(`${file}:${i+1} — set${m[1]}() but "${stateName}" in deps [${deps.trim().slice(0,100)}]`);
      }
    }
  }
}

if (issues.length === 0) {
  console.log('No circular useEffect patterns found!');
} else {
  issues.forEach(i => console.log(i));
  console.log('\nTotal:', issues.length);
}
