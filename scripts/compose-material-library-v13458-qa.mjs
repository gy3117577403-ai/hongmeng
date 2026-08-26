import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const referencePath = 'C:/Windows/TEMP/codex-clipboard-0d428b77-0802-459d-b92a-78f2cfb6b1c9.png';
const implementationPath = path.join(
  root,
  'artifacts/material-library-v13458/qa/implementation-2048x1177.png',
);
const outputPath = path.join(
  root,
  'artifacts/material-library-v13458/qa/reference-implementation-2048x1177.png',
);
const width = 2048;
const height = 1177;

const [reference, implementation] = await Promise.all([
  sharp(referencePath).resize(width, height, { fit: 'fill' }).png().toBuffer(),
  sharp(implementationPath).resize(width, height, { fit: 'fill' }).png().toBuffer(),
]);

await sharp({
  create: {
    width: width * 2,
    height,
    channels: 4,
    background: '#ffffff',
  },
})
  .composite([
    { input: reference, left: 0, top: 0 },
    { input: implementation, left: width, top: 0 },
  ])
  .png()
  .toFile(outputPath);

console.log(outputPath);
