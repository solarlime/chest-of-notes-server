import { Readable } from 'stream';
import { Response } from 'express';
import { Db, GridFSBucket } from 'mongodb';
import { createFFmpeg, fetchFile, FFmpeg } from '@ffmpeg/ffmpeg';
import EventEmitter from 'events';
import { ExtendedRequest, NotificationEvent } from './types.js';

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
async function addOne(req: ExtendedRequest, res: Response, emitter: EventEmitter) {
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
        await col.insertOne({
          id: body.id, name: body.name, type: body.type,
        });
        res.status(200).json({ status: 'Added', data: body.id });
        // Converting is done after res was sent.
        // A user is notified if it was successful or not
        await ffmpeg.load();
        ffmpeg.FS('writeFile', `${body.id}`, await fetchFile(file.buffer));
        await ffmpeg.run('-i', `${body.id}`, '-c:v', 'libx264', `${body.id}.mp4`);
        await addToGridFS(body.id, dbFiles, bucketName, ffmpeg);
        const event: NotificationEvent = { id: body.id, name: 'uploadsuccess', note: body.name };
        emitter.emit('uploadsuccess', event);
      } catch (e) {
        if (res.writableEnded) {
          // If a response was sent, an error occurred with a file.
          // So, we need to clear its note's data
          await col.deleteOne({ id: body.id });
          const event: NotificationEvent = { id: body.id, name: 'uploaderror', note: body.name };
          emitter.emit('uploaderror', event);
        } else {
          res.status(500).json({ status: 'Error: not added', data: (e as Error).message });
        }
      }
    }
  } catch (e) {
    res.status(500).json({ status: 'Error: not added', data: (e as Error).message });
  }
}

export default addOne;
