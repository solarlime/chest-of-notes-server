import { Readable } from 'stream';
import { Response } from 'express';
import { Db, GridFSBucket } from 'mongodb';
import { createFFmpeg, fetchFile, FFmpeg } from '@ffmpeg/ffmpeg';
import ExtendedRequest from './types.js';

/**
 * A function for adding a file to GridFS
 * @param id - a generated filename
 * @param dbFiles - a files' database name
 * @param bucketName - a GridFSBucket name
 * @param ffmpeg - a ffmpeg-wasm object
 */
async function addToGridFS(
  id: string,
  dbFiles: Db,
  bucketName: string,
  ffmpeg: FFmpeg,
) {
  const bucket = new GridFSBucket(dbFiles, { bucketName });
  const uploadStream = bucket.openUploadStream(id);
  const readable = ffmpeg.FS('readFile', `${id}.mp4`);
  const reader = Readable.from(Buffer.from(readable));
  reader.pipe(uploadStream);
  await new Promise<void>((resolve, reject) => {
    reader.on('error', (err) => reject(err));
    uploadStream.on('close', () => {
      reader.destroy();
      ffmpeg.FS('unlink', `${id}.mp4`);
      ffmpeg.exit();
      resolve();
    });
  });
}

/**
 * A middleware for adding notes
 */
async function addOne(req: ExtendedRequest, res: Response) {
  console.log('Trying to add a note...');
  const col = req.col!;
  const bucketName = req.bucketName!;
  const dbFiles = req.dbFiles!;
  try {
    const { body, file } = req;
    if (!file) {
      // A text note is expected
      if (body.type === 'text') {
        await col.insertOne({
          id: body.id, name: body.name, type: body.type, content: body.content,
        });
        res.status(200).json({ status: 'Added', data: body.id });
      } else {
        res.status(500).json({ status: 'Error: not added', data: 'Oops! Body.type is not \'text\', but there is no file!' });
      }
    } else {
      // An audio/video note is received
      try {
        // Different browsers record and play media with various types.
        // It's necessary to store them in the only one type.
        // Ffmpeg converts recorded files to h.264/aac mp4 files. Then they're put to GridFS.
        const ffmpeg = createFFmpeg({
          log: true,
          logger: ({ message }) => console.log(message),
          progress: (p) => console.log(p),
        });
        await ffmpeg.load();
        ffmpeg.FS('writeFile', `${body.id}`, await fetchFile(file.buffer));
        await ffmpeg.run('-i', `${body.id}`, '-c:v', 'libx264', `${body.id}.mp4`);
        await addToGridFS(body.id, dbFiles, bucketName, ffmpeg);
        await col.insertOne({
          id: body.id, name: body.name, type: body.type,
        });
        res.status(200).json({ status: 'Added', data: body.id });
      } catch (e) {
        res.status(500).json({ status: 'Error: not added', data: (e as Error).message });
      }
    }
  } catch (e) {
    res.status(500).json({ status: 'Error: not added', data: (e as Error).message });
  }
}

export default addOne;
