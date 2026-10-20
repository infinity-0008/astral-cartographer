import { parseFile } from './parseFile.js';
export default function parseChunk({ files }) {
  return files.map(file => parseFile(file.id, file.code));
}
