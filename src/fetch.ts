import fs from 'node:fs';
import { Collection, GridFSBucket } from 'mongodb';
import { Response } from 'express';
import { ExtendedRequest } from './types.js';

/**
 * A middleware for fetching all notes
 */
async function fetchAll(req: ExtendedRequest, res: Response) {
  try {
    console.log('Trying to fetch all notes...');
    // @ts-ignore
    const col = req.col as Collection;
    const data = await col.find().toArray();
    res.status(200).json({
      status: 'Fetched',
      data: data.map((note) => {
        const { _id, ...rest } = note;
        if (!note.content && note.type !== 'text') rest.content = 'media';
        return rest;
      }),
    });
  } catch (e) {
    res.status(500).json({ status: 'Error: not fetched', data: (e as Error).message });
  }
}

/**
 * A middleware for streaming a chosen media from a note
 */
async function fetchOne(req: ExtendedRequest, res: Response) {
  console.log('Trying to fetch one note...');
  try {
    // Thanks to Ashley Davis for a solution with Safari
    // https://blog.logrocket.com/streaming-video-in-safari/

    const options: { start?: number, end?: number } = {};

    let start: number;
    let end: number;

    // At first, we need to define bytes to send
    const { range } = req.headers;
    if (range) {
      const bytesPrefix = 'bytes=';
      if (range.startsWith(bytesPrefix)) {
        const bytesRange = range.substring(bytesPrefix.length);
        const parts = bytesRange.split('-');
        if (parts.length === 2) {
          const rangeStart = parts[0] && parts[0].trim();
          if (rangeStart && rangeStart.length > 0) {
            start = parseInt(rangeStart, 10);
            options.start = start;
          }
          const rangeEnd = parts[1] && parts[1].trim();
          if (rangeEnd && rangeEnd.length > 0) {
            end = parseInt(rangeEnd, 10);
            options.end = end;
          }
        }
      }
    }

    res.setHeader('content-type', 'video/mp4');

    const bucketName = req.bucketName!;
    const dbFiles = req.dbFiles!;
    const fileId = req.params.id;

    // Direct streaming from GridFS doesn't work correctly.
    // So, we need to copy a file to fs and then to stream it
    const bucket = new GridFSBucket(dbFiles, { bucketName });
    fs.open(`${fileId}.mp4`, 'r', async (err) => {
      // fs.open() checks if the file exists (this may be so on recurring requests)
      if (err) {
        await new Promise<void>((resolve, reject) => {
          const downloadStream = bucket.openDownloadStreamByName(fileId, {});
          const tempStream = fs.createWriteStream(`${fileId}.mp4`);
          downloadStream.on('error', (e) => {
            console.log('Streaming ended with an error: ', e);
            downloadStream.destroy();
            reject();
          });
          downloadStream.on('end', () => {
            console.log('File is loaded from GridFS!');
            downloadStream.destroy();
            resolve();
          });
          downloadStream.pipe(tempStream);
          const deleteTimeout = setTimeout(() => {
            clearTimeout(deleteTimeout);
            fs.unlink(`${fileId}.mp4`, (e) => {
              if (e) {
                console.log(`File ${fileId}.mp4 was not deleted`);
              } else {
                console.log(`Completed deleting ${fileId}.mp4`);
              }
            });
          }, 60000);
        });
      } else {
        console.log('File exists');
      }

      const filePath = `${fileId}.mp4`;

      fs.stat(filePath, (e, stat) => {
        if (e) {
          console.error(`File stat error for ${filePath}.`);
          console.error(err);
          res.sendStatus(500);
          return;
        }

        const contentLength = stat.size;

        // HEAD request should be handled separately
        if (req.method === 'HEAD') {
          res.statusCode = 200;
          res.setHeader('accept-ranges', 'bytes');
          res.setHeader('content-length', contentLength);
          res.end();
        } else {
          let retrievedLength;
          if (start !== undefined && end !== undefined) {
            retrievedLength = (end + 1) - start;
          } else if (start !== undefined) {
            retrievedLength = contentLength - start;
          } else if (end !== undefined) {
            retrievedLength = (end + 1);
          } else {
            retrievedLength = contentLength;
          }

          res.statusCode = start !== undefined || end !== undefined ? 206 : 200;

          res.setHeader('content-length', retrievedLength);

          if (range !== undefined) {
            res.setHeader('content-range', `bytes ${start || 0}-${end || (contentLength - 1)}/${contentLength}`);
            res.setHeader('accept-ranges', 'bytes');
          }

          const fileStream = fs.createReadStream(filePath, options);
          fileStream.on('error', (error) => {
            console.log(`Error reading file ${filePath}.`);
            console.log(error);
            res.sendStatus(500);
          });

          fileStream.pipe(res);
        }
      });
    });
  } catch (e) {
    res.status(500).json({ status: 'Error: not fetched', data: (e as Error).message });
  }
}

export { fetchAll, fetchOne };
