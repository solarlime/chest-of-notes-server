import { Response } from 'express';
import { Db, GridFSBucket } from 'mongodb';
import EventEmitter from 'events';
import path from 'node:path';
import { ChildProcess, fork } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ExtendedRequest, LaunchMessage, NotificationEvent } from './types.js';

/**
 * A function for adding a file to GridFS
 * @param id - a generated filename
 * @param dbFiles - a files' database name
 * @param bucketName - a GridFSBucket name
 */
async function addToGridFS(
  id: string,
  dbFiles: Db,
  bucketName: string,
) {
  const bucket = new GridFSBucket(dbFiles, { bucketName });
  const uploadStream = bucket.openUploadStream(id);
  const readable = createReadStream(`${id}.mp4`);
  readable.pipe(uploadStream);
  await new Promise<void>((resolve, reject) => {
    readable.on('error', (err) => reject(err));
    uploadStream.on('close', () => {
      readable.destroy();
      console.log(`Added ${id}.mp4 to GridFS!`);
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
        await col.insertOne({
          id: body.id, name: body.name, type: body.type, uploadComplete: false,
        });
        res.status(200).json({ status: 'Added', data: body.id, uploadComplete: false });

        const extension = path.extname(import.meta.url);
        let ffmpegProcess: ChildProcess;
        switch (extension) {
          case '.ts': {
            const filePath = fileURLToPath(new URL('./ffmpeg.ts', import.meta.url));
            ffmpegProcess = fork(filePath);
            break;
          }
          default: {
            const filePath = fileURLToPath(new URL('./ffmpeg.js', import.meta.url));
            ffmpegProcess = fork(filePath);
            break;
          }
        }

        ffmpegProcess.on('message', async (message: LaunchMessage) => {
          if (message.name === 'encoded') {
            console.log(`Adding ${message.id}.mp4 to GridFS...`);
            await addToGridFS(message.id, dbFiles, bucketName);
            await col.updateOne(
              { id: message.id },
              { $set: { id: message.id, uploadComplete: true } },
            );
            const event: NotificationEvent = { id: message.id, name: 'uploadsuccess', note: body.name };
            emitter.emit('uploadsuccess', event);
            await unlink(`${message.id}.mp4`);
            console.log(`Removed temporary file ${message.id}.mp4`);
          } else {
            const error = 'Another message from a subprocess was received!';
            console.log(error);
            throw Error(error);
          }
        });

        ffmpegProcess.on('error', () => {
          res.status(500).json({ status: 'Error: not added', data: 'An encoding process threw an error!' });
          console.log('ffmpegProcess error occurred!');
        });

        const message: LaunchMessage = {
          name: 'launch', id: body.id, buffer: file.buffer,
        };
        ffmpegProcess.send(JSON.stringify(message));
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
