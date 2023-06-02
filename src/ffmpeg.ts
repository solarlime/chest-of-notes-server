import { createFFmpeg, fetchFile } from '@ffmpeg.wasm/main';
import { Readable } from 'node:stream';
import { createWriteStream } from 'node:fs';
import { LaunchMessage, ReceivedBuffer } from './types.js';

console.log('Launched ffmpeg process!');

process.on('message', async (m: string) => {
  const mes = JSON.parse(m) as LaunchMessage;
  if (mes.name === 'launch') {
    try {
      const { id, buffer } = mes;
      if (!buffer) {
        throw Error('File.buffer is undefined');
      }
      if (!(buffer as ReceivedBuffer).data) {
        throw Error('Data property is undefined');
      }
      const rawBuffer = Buffer.from((buffer as ReceivedBuffer).data);
      // Different browsers record and play media with various types.
      // It's necessary to store them in the only one type.
      // Ffmpeg converts recorded files to h.264/aac mp4 files. Then they're put to GridFS.
      const ffmpeg = createFFmpeg({
        log: true,
        logger: ({ message }) => console.log(message),
        progress: (p) => console.log(p),
      });
      // Converting is done after res was sent.
      // A user is notified if it was successful or not
      await ffmpeg.load();
      ffmpeg.FS('writeFile', `${id}`, await fetchFile(rawBuffer));
      await ffmpeg.run('-i', `${id}`, '-c:v', 'libx264', `${id}.mp4`);
      const readable = ffmpeg.FS('readFile', `${id}.mp4`);
      const reader = Readable.from(Buffer.from(readable));
      const uploadStream = createWriteStream(`${id}.mp4`);
      reader.pipe(uploadStream);
      await new Promise<void>((resolve, reject) => {
        reader.on('error', (err) => reject(err));
        uploadStream.on('close', () => {
          console.log(`Encoded to a temporary file ${id}.mp4`);
          reader.destroy();
          ffmpeg.FS('unlink', `${id}.mp4`);
          ffmpeg.exit();
          resolve();
        });
      });
      if (process.send) process.send({ name: 'encoded', id });
    } catch (e) {
      if (process.send) process.send((e as Error).message);
    } finally {
      console.log('Exiting ffmpeg process!');
      process.exit(0);
    }
  }
});
