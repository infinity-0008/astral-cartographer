const stamp = () => new Date().toISOString();
export const logger = {
  info: (message, data) => console.log(`[${stamp()}] INFO  ${message}`, data ?? ''),
  warn: (message, data) => console.warn(`[${stamp()}] WARN  ${message}`, data ?? ''),
  error: (message, data) => console.error(`[${stamp()}] ERROR ${message}`, data ?? '')
};
