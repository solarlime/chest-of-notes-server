import dotenv from 'dotenv';
import fetch, { Headers } from 'node-fetch';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import EventEmitter from 'node:events';
import { fetchAll, fetchOne } from './fetch.js';
import { ExtendedRequest, NotificationEvent } from './types.js';
import deleteOne from './delete.js';
import addOne from './add.js';

dotenv.config();
const { MONGO_URL, PORT } = process.env;
const dbFiles = 'db-files';
const dbName = 'chest-of-notes';
const bucketName = dbName.replace(/-/g, '_');

/**
 * Define the routes for our convenience
 */
type Basis = { [key: string]: string };

const basis: Basis = {
  prefix: `/${dbName}`,
  notifications: '/notifications',
  mongo: '/mongo',
  fetch: '/fetch',
  add: '/add',
  delete: '/delete',
};

const routes = {
  notifications: basis.prefix + basis.notifications,
  fetch: basis.prefix + basis.mongo + basis.fetch,
  add: basis.prefix + basis.mongo + basis.add,
  delete: basis.prefix + basis.mongo + basis.delete,
};

/**
 * Init a web server
 */
const app = express();
const memory = multer.memoryStorage();
const multiparser = multer({ storage: memory, limits: { fieldSize: 40 * 1024 * 1024 } });
const emitter = new EventEmitter();

app.disable('x-powered-by');
app.use(cors({
  origin: ['http://localhost:9000', 'https://chest-of-notes-solarlime.vercel.app', 'https://chest-of-notes.solarlime.dev'],
  methods: ['GET', 'POST'],
  credentials: true,
}));

/**
 * A middleware for connecting to MongoDB
 */
const connectToMongo = async (
  req: ExtendedRequest,
  res: express.Response,
  next: express.NextFunction,
) => {
  try {
    const client = new MongoClient(MONGO_URL!);
    await client.connect();
    console.log('Connected correctly to server');
    const db = client.db(dbName);

    req.dbFiles = client.db(dbFiles);
    req.bucketName = bucketName;
    req.col = db.collection('notes');
    await next();
  } catch (e) {
    res.status(500).send({ status: 'Error: not connected', data: (e as Error).message });
  }
};

/**
 * A middleware for server-sent notifications
 */
const notifyAboutUploads = (req: ExtendedRequest, res: express.Response) => {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('connection', 'keep-alive');
  res.write('\n\n');
  if (emitter.eventNames().length > 0) {
    res.write('id: 0\nevent: deny\ndata:\n\n');
  } else {
    console.log('Trying to subscribe to notifications');

    const successCallback = (event: NotificationEvent) => { res.write(`id: ${event.id}\nevent: ${event.name}\ndata: ${event.note}\n\n`); };
    const errorCallback = (event: NotificationEvent) => { res.write(`id: ${event.id}\nevent: ${event.name}\ndata: ${event.note}\n\n`); };
    emitter.on('uploadsuccess', successCallback);
    emitter.on('uploaderror', errorCallback);
    req.on('close', () => {
      emitter.removeListener('uploadsuccess', successCallback);
      emitter.removeListener('uploaderror', errorCallback);
      console.log('Removed all upload listeners');
    });
  }
};

app.get(`${routes.fetch}/all/`, connectToMongo, (req, res) => fetchAll(req, res));
app.get(`${routes.fetch}/:id/`, connectToMongo, (req, res) => fetchOne(req, res));
app.post(`${routes.add}/`, multiparser.single('content'), connectToMongo, (req, res) => addOne(req, res, emitter));
app.get(`${routes.delete}/:id/`, connectToMongo, (req, res) => deleteOne(req, res));
app.get(`${routes.notifications}/`, (req, res) => notifyAboutUploads(req, res));
app.all('*', (req: express.Request, res: express.Response) => { res.status(404).send('Not found'); });

/**
 * A function which cleans incomplete notes (after a server restart) if there are
 * @param task - a custom header telling the server about the issuer
 */
const cleanIncompleteUploads = async (task: string) => {
  const headers = new Headers({ task });
  const res = await fetch(`http://localhost:${PORT}${routes.fetch}/all/`).then((result) => result.json()) as
    { status: string, data: string | Array<{ [key: string]: string | boolean }> };
  if (typeof res.data === 'string') {
    console.log(`${res.status}. ${res.data}`);
  } else {
    const incompleteNotesIds = res.data.filter((item) => item.uploadComplete === false)
      .map((item) => item.id);
    if (incompleteNotesIds.length > 0) {
      try {
        const cleaned = await Promise.all(incompleteNotesIds.map((id) => fetch(`http://localhost:${PORT}${routes.delete}/${id}/`, { headers })
          .then((r) => r.json()).then((r) => {
            const result = r as { status: string, data: string };
            if (result.status === 'Error: not deleted') throw Error(result.data);
            return result;
          })));
        console.log(`Got rid of ${cleaned.length} incomplete notes!`);
      } catch (e) {
        console.log((e as Error));
      }
    }
  }
};

app.listen(PORT, async () => {
  const { name } = cleanIncompleteUploads;
  await cleanIncompleteUploads(name);
  console.log('Server is listening on %s', PORT);
});
