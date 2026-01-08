import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { join } from 'path';

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const inputFile = 'app-icon.png';
const outputDir = 'public/icons';

async function generateIcons() {
  await mkdir(outputDir, { recursive: true });
  
  for (const size of sizes) {
    const outputFile = join(outputDir, `icon-${size}x${size}.png`);
    await sharp(inputFile)
      .resize(size, size)
      .png()
      .toFile(outputFile);
    console.log(`Generated: ${outputFile}`);
  }
  
  // 生成 favicon
  await sharp(inputFile)
    .resize(32, 32)
    .png()
    .toFile('public/favicon.png');
  console.log('Generated: public/favicon.png');
  
  // 生成 apple-touch-icon
  await sharp(inputFile)
    .resize(180, 180)
    .png()
    .toFile('public/apple-touch-icon.png');
  console.log('Generated: public/apple-touch-icon.png');
}

generateIcons().catch(console.error);
