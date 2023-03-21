import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import { fetchAll, fetchOne } from './fetch.js';
import ExtendedRequest from './types.js';
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
  mongo: '/mongo',
  fetch: '/fetch',
  add: '/add',
  delete: '/delete',
};

const routes = {
  fetch: basis.prefix + basis.mongo + basis.fetch,
  add: basis.prefix + basis.mongo + basis.add,
  delete: basis.prefix + basis.mongo + basis.delete,
};

/**
 * Init a web server
 */
const app = express();
const memory = multer.memoryStorage();
const multiparser = multer({ storage: memory });

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

app.get(`${routes.fetch}/all/`, connectToMongo, (req: ExtendedRequest, res: express.Response) => fetchAll(req, res));
app.get(`${routes.fetch}/:id/`, connectToMongo, (req, res) => fetchOne(req, res));
app.post(`${routes.add}/`, multiparser.single('content'), connectToMongo, (req, res) => addOne(req, res));
app.get(`${routes.delete}/:id/`, connectToMongo, (req, res) => deleteOne(req, res));
app.all('*', (req: express.Request, res: express.Response) => { res.status(404).send('Not found'); });

app.listen(PORT, () => { console.log('Server is listening on %s', PORT); });
