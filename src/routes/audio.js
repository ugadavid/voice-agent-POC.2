import express from "express";
import path from "path";

const router = express.Router();

const AUDIO_DIR = path.resolve("tmp_audio");

router.get("/tmp/:file", (req, res) => {
  const file = req.params.file;

  const filePath = path.join(AUDIO_DIR, file);

  res.sendFile(filePath, (err) => {
    if (err) res.sendStatus(404);
  });
});

export default router;
