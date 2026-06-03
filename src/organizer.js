import { generateObject } from 'ai';
import { createGateway } from '@ai-sdk/gateway';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { transcribePdf } from './transcriber.js';
import { logger } from './logger.js';

const gateway = createGateway({
  apiKey: process.env.VERCEL_AI_GATEWAY_TOKEN,
});

// Minimum number of extracted characters to trust a PDF's embedded text layer.
// Below this we treat the PDF as scanned/image-based and fall back to OCR.
const MIN_TEXT_LAYER_CHARS = 20;

const extractPdfText = async (filePath) => {
  const filename = path.basename(filePath);

  // First try the fast path: pull the embedded text layer.
  try {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    // Only send the first 2000 characters to keep API costs low
    const text = data.text.slice(0, 2000).trim();
    if (text.length >= MIN_TEXT_LAYER_CHARS) return text;
  } catch (err) {
    logger.warn(`Could not parse text layer of ${filename}, falling back to OCR`);
  }

  // No usable text layer — this is a scanned/image-based PDF. Read it with vision.
  try {
    logger.info(`No text layer in ${filename} — running OCR`);
    const transcript = await transcribePdf(filePath);
    const text = transcript ? transcript.slice(0, 2000).trim() : '';
    return text.length > 0 ? text : null;
  } catch (err) {
    logger.warn(`Could not OCR ${filename}, using filename only`);
    return null;
  }
};

export const organizeFile = async (filePath, watchPath) => {
  const filename = path.basename(filePath);
  logger.info(`New file detected: ${filename}`);

  // Get existing folder structure so AI is aware of it
  const existingFolders = fs.readdirSync(watchPath, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  // Extract PDF text for better classification
  const pdfText = await extractPdfText(filePath);

  const prompt = `You are an intelligent document organizer for a home NAS system.
  
A new PDF has been added. Your job is to decide where it belongs.

Filename: ${filename}
${pdfText ? `Document preview:\n${pdfText}` : 'Could not extract text — use filename only.'}

Existing folders on the drive:
${existingFolders.length > 0 ? existingFolders.join('\n') : 'No folders yet — you must create one.'}

Rules:
- Reuse an existing folder if it clearly fits
- Create a new folder name if none of the existing ones fit
- Folder names should be short, clear, Title Case (e.g. "Tax Documents", "Contracts", "Manuals")
- Suggest a cleaner filename if the current one is messy (keep the .pdf extension)
- If the content is unclear, use your best guess based on the filename`;

  const { object } = await generateObject({
    model: gateway('anthropic/claude-haiku-4-5'),
    schema: z.object({
      folder: z.string().describe('Folder name to move the file into'),
      rename: z.string().describe('New filename including .pdf extension'),
      reason: z.string().describe('Brief explanation of why this folder was chosen'),
      isNewFolder: z.boolean().describe('Whether this is a newly created folder or an existing one'),
    }),
    prompt,
  });

  return object;
};

export const organizeImage = async (filePath, watchPath, transcript) => {
  const filename = path.basename(filePath);
  const ext = path.extname(filename);

  const existingFolders = fs.readdirSync(watchPath, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const prompt = `You are an intelligent document organizer for a home NAS system.

An image file has been added and its text content has been transcribed. Your job is to decide where it belongs.

Filename: ${filename}
${transcript ? `Transcribed content:\n${transcript.slice(0, 2000)}` : 'No text could be transcribed — use filename only.'}

Existing folders on the drive:
${existingFolders.length > 0 ? existingFolders.join('\n') : 'No folders yet — you must create one.'}

Rules:
- Reuse an existing folder if it clearly fits
- Create a new folder name if none of the existing ones fit
- Folder names should be short, clear, Title Case (e.g. "Tax Documents", "Receipts", "Manuals")
- Suggest a cleaner filename if the current one is messy (keep the ${ext} extension)
- If the content is unclear, use your best guess based on the filename`;

  const { object } = await generateObject({
    model: gateway('anthropic/claude-haiku-4-5'),
    schema: z.object({
      folder: z.string().describe('Folder name to move the file into'),
      rename: z.string().describe(`New filename including ${ext} extension`),
      reason: z.string().describe('Brief explanation of why this folder was chosen'),
      isNewFolder: z.boolean().describe('Whether this is a newly created folder or an existing one'),
    }),
    prompt,
  });

  return object;
};

export const moveFile = (filePath, watchPath, folder, newFilename) => {
  const destDir = path.join(watchPath, folder);

  // Create folder if it doesn't exist
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    fs.chmodSync(destDir, 0o777);
  }

  const destPath = path.join(destDir, newFilename);

  // Avoid overwriting existing files
  if (fs.existsSync(destPath)) {
    const ext = path.extname(newFilename);
    const base = path.basename(newFilename, ext);
    const timestamp = Date.now();
    const safeDest = path.join(destDir, `${base}_${timestamp}${ext}`);
    fs.renameSync(filePath, safeDest);
    try { fs.chmodSync(safeDest, 0o666); } catch (_) {}
    return safeDest;
  }

  fs.renameSync(filePath, destPath);
  try { fs.chmodSync(destPath, 0o666); } catch (_) {}
  return destPath;
};