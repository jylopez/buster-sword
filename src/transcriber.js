import { generateText } from 'ai';
import { createGateway } from '@ai-sdk/gateway';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const gateway = createGateway({
  apiKey: process.env.VERCEL_AI_GATEWAY_TOKEN,
});

const SUPPORTED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif']);

export const isImageFile = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_IMAGE_EXTS.has(ext);
};

const toJpegBuffer = async (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);

  if (ext === '.heic' || ext === '.heif') {
    return sharp(buffer).jpeg({ quality: 90 }).toBuffer();
  }

  if (ext === '.jpg' || ext === '.jpeg') {
    return buffer;
  }

  // PNG, GIF, WebP — convert to JPEG for consistency
  return sharp(buffer).jpeg({ quality: 90 }).toBuffer();
};

export const transcribeImage = async (filePath) => {
  const jpegBuffer = await toJpegBuffer(filePath);
  const base64 = jpegBuffer.toString('base64');

  const { text } = await generateText({
    model: gateway('anthropic/claude-haiku-4-5'),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            image: base64,
            mimeType: 'image/jpeg',
          },
          {
            type: 'text',
            text: 'Transcribe all handwritten and printed text in this image exactly as written. Preserve the original layout using line breaks. Do not add commentary or explanations — only output the transcribed text.',
          },
        ],
      },
    ],
  });

  return text;
};