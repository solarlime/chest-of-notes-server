import EventEmitter from 'node:events';
import { open, unlink, createReadStream } from 'node:fs';
import * as child_process from 'node:child_process';
import { Db, GridFSBucket } from 'mongodb';
import { Response } from 'express';
import { ExtendedRequest, NotificationEvent } from './types.js';

/**
 * A function for adding a file to GridFS
 * @param id - a generated filename
 * @param dbFiles - a files' database name
 * @param bucketName - a GridFSBucket name
 * @param convertedFile - a name of the converted file
 */
const addToGridFS = (
  id: string,
  dbFiles: Db,
  bucketName: string,
  convertedFile: string,
) => new Promise<void>((resolve, reject) => {
  open(convertedFile, 'r', (err) => {
    if (err) {
      reject(Error('Seems to be an FFmpeg error: file is corrupted'));
    } else {
      const deleteFile = (callback: Function, error?: Error) => unlink(convertedFile, (e) => {
        if (e) {
          console.log(`File ${convertedFile} was not deleted`);
        } else {
          console.log(`Completed deleting ${convertedFile}`);
        }
        if (error) {
          callback(error);
        } else {
          callback();
        }
      });

      const bucket = new GridFSBucket(dbFiles, { bucketName });
      const uploadStream = bucket.openUploadStream(id);
      uploadStream.on('error', (error) => deleteFile(reject, error));
      uploadStream.on('close', () => {
        console.log(`Added ${id} to GridFS!`);
        deleteFile(resolve);
      });
      const readableStream = createReadStream(convertedFile);
      readableStream.pipe(uploadStream, { end: true });
    }
  });
});

/**
 * A function converting media files via ffmpeg
 * @param file - a media file
 * @param convertedFile - a name of the converted file
 */
const convertFile = (file: Express.Multer.File, convertedFile: string) => new Promise<void>(
  (resolve, reject) => {
    const ffmpeg = child_process.spawn(
      'ffmpeg',
      [
        '-y', // Overwrite output
        '-i', '-', // Set input to stdin
        '-c:v', 'libx264', // Set video codec to h.264
        '-f', 'mp4', // Set output format to mp4
        convertedFile,
      ],
    );

    ffmpeg.on('error', (error) => reject(error));

    ffmpeg.stderr.on('data', (chunk) => {
      const textChunk = chunk.toString('utf8');
      console.error(textChunk);
    });

    ffmpeg.stdout.on('end', () => {
      console.log('FFmpeg converting ended!');
      // Stdin still exists!
      ffmpeg.stdin.destroy();
      resolve();
    });

    ffmpeg.stdin.write(file.buffer);
    ffmpeg.stdin.end();
  },
);

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
        // Different browsers record and play media with various types.
        // It's necessary to store them in the only one type.
        // Ffmpeg converts recorded files to h.264/aac mp4 files. Then they're put to GridFS.
        // Converting is done after res was sent.
        // A user is notified if it was successful or not
        const convertedFile = `${body.id}-converted.mp4`;
        await convertFile(file, convertedFile);
        delete req.file;
        await addToGridFS(body.id, dbFiles, bucketName, convertedFile);
        await col.updateOne({ id: body.id }, { $set: { id: body.id, uploadComplete: true } });
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
