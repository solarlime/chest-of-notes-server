import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import EventEmitter from 'events';
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
  console.log('Trying to subscribe to notifications');
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('connection', 'keep-alive');

  emitter.on('uploadsuccess', (event: NotificationEvent) => { res.write(`id: ${event.id}\nevent: ${event.name}\ndata: ${event.note}\n\n`); });
  emitter.on('uploaderror', (event: NotificationEvent) => { res.write(`id: ${event.id}\nevent: ${event.name}\ndata: ${event.note}\n\n`); });
};

app.get(`${routes.fetch}/all/`, connectToMongo, (req, res) => fetchAll(req, res));
app.get(`${routes.fetch}/:id/`, connectToMongo, (req, res) => fetchOne(req, res));
app.post(`${routes.add}/`, multiparser.single('content'), connectToMongo, (req, res) => addOne(req, res, emitter));
app.get(`${routes.delete}/:id/`, connectToMongo, (req, res) => deleteOne(req, res));
app.get(`${routes.notifications}/`, (req, res) => notifyAboutUploads(req, res));
app.all('*', (req: express.Request, res: express.Response) => { res.status(404).send('Not found'); });

app.listen(PORT, () => { console.log('Server is listening on %s', PORT); });
