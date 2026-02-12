import fs from "fs";
import path from "path";
import crypto from "crypto";

const AUDIO_DIR = path.resolve("tmp_audio");

if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

export function saveBase64Mp3(base64) {
  const id = crypto.randomUUID();
  const file = `${id}.mp3`;
  const filePath = path.join(AUDIO_DIR, file);

  const buffer = Buffer.from(base64, "base64");
  fs.writeFileSync(filePath, buffer);

  return { id, file, filePath };
}
