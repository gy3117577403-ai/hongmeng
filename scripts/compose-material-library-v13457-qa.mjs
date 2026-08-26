import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const referencePath = 'C:/Users/31175/.codex/generated_images/01a03791-4813-7aa3-ab3d-06de901ce204/exec-23a187d8-c96f-4606-9d56-c13cb6139288.png';
const implementationPath = path.join(root, 'artifacts/material-library-v13457/qa/desktop-final-1366x1024.png');
const outputPath = path.join(root, 'artifacts/material-library-v13457/qa/reference-implementation-1366x1024.png');
const width = 1366;
const height = 1024;

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
