import { Request } from 'express';
import { Collection, Db } from 'mongodb';

export interface ExtendedRequest extends Request {
  dbFiles?: Db,
  bucketName?: string,
  col?: Collection,
}

export type EventName = 'uploadsuccess' | 'uploaderror';

export type NotificationEvent<T extends EventName> = {
  id: string, name: T, note: string, message?: T extends 'uploaderror' ? string : never,
};
