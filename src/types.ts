import { Request } from 'express';
import { Collection, Db } from 'mongodb';

export interface ExtendedRequest extends Request {
  dbFiles?: Db,
  bucketName?: string,
  col?: Collection,
}

export type NotificationEvent = {
  id: string, name: 'uploadsuccess' | 'uploaderror', note: string,
};
