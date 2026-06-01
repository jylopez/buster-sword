import { generateObject } from 'ai';
import { createGateway } from '@ai-sdk/gateway';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { logger } from './logger.js';

const gateway = createGateway({
  apiKey: process.env.VERCEL_AI_GATEWAY_TOKEN,
});

const extractPdfText = async (filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    // Only send the first 2000 characters to keep API costs low
    return data.text.slice(0, 2000).trim();
  } catch (err) {
    logger.warn(`Could not extract text from ${path.basename(filePath)}, using filename only`);
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
    fs.chmodSync(safeDest, 0o666);
    return safeDest;
  }

  fs.renameSync(filePath, destPath);
  fs.chmodSync(destPath, 0o666);
  return destPath;
};