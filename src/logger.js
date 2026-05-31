const timestamp = () => new Date().toISOString();

export const logger = {
  info: (msg) => console.log(`[${timestamp()}] INFO: ${msg}`),
  error: (msg, err) => console.error(`[${timestamp()}] ERROR: ${msg}`, err ?? ''),
  success: (msg) => console.log(`[${timestamp()}] ✓ ${msg}`),
  warn: (msg) => console.warn(`[${timestamp()}] WARN: ${msg}`),
};