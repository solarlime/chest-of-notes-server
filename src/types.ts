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

export type ReceivedBuffer = { type: 'Buffer', data: Array<any> };
export interface LaunchMessage {
  name: 'launch' | 'encoded',
  id: string,
  buffer?: Buffer | ReceivedBuffer,
}
