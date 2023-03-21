import { Request } from 'express';
import { Collection, Db } from 'mongodb';

export default interface ExtendedRequest extends Request {
  dbFiles?: Db,
  bucketName?: string,
  col?: Collection,
}
