import { GridFSBucket } from 'mongodb';
import { Response } from 'express';
import { ExtendedRequest } from './types.js';

/**
 * A middleware for deleting notes
 */
async function deleteOne(req: ExtendedRequest, res: Response) {
  try {
    console.log('Trying to delete a note...');
    const col = req.col!;
    const bucketName = req.bucketName!;
    const dbFiles = req.dbFiles!;
    const fileId = req.params.id;
    const object = await col.findOne({ id: fileId });
    if (object) {
      if (object.type !== 'text') {
        const bucket = new GridFSBucket(dbFiles, { bucketName });
        const file = await dbFiles.collection(`${bucketName}.files`).findOne({ filename: fileId });
        if (file) {
          // eslint-disable-next-line no-underscore-dangle
          await bucket.delete(file._id);
        } else if (!req.headers.task) {
          throw Error(`A note ${fileId} is found, but there is no expected file`);
        }
      }
      const result = await col.deleteOne({ id: fileId });
      if (result.deletedCount === 1) {
        res.status(200).json({ status: 'Deleted', data: fileId });
      } else {
        throw Error(`Failed to delete an existing ${fileId} note`);
      }
    } else {
      throw Error(`A note ${fileId} is not found`);
    }
  } catch (e) {
    res.status(500).json({ status: 'Error: not deleted', data: (e as Error).message });
  }
}

export default deleteOne;
