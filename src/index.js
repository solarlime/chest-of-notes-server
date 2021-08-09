const dotenv = require('dotenv');
const { Readable } = require('stream');
const Koa = require('koa');
const Router = require('@koa/router');
const koaBody = require('koa-body');
const koaCors = require('@koa/cors');
const { MongoClient, GridFSBucket } = require('mongodb');

/**
 * Make a serverless function with Koa
 * @type {Application}
 */

dotenv.config();
const app = new Koa();
const prefix = '/chest-of-notes';
const router = new Router({ prefix });
const { MONGO_URL, PORT } = process.env;
const dbName = 'chest-of-notes';
const filesDB = 'db-files';

/**
 * Define the routes for our convenience
 * @returns {{mongo: string, fetchAll: string, update: string, delete: string, fetchOne: string}}
 */
function routesF() {
  const basis = {
    mongo: '/mongo',
    fetch: '/fetch',
    all: '/all',
    one: '/one',
    update: '/update',
    delete: '/delete',
  };
  return {
    mongo: basis.mongo,
    fetchAll: basis.mongo + basis.fetch + basis.all,
    fetchOne: basis.mongo + basis.fetch + basis.one,
    update: basis.mongo + basis.update,
    delete: basis.mongo + basis.delete,
  };
}
const routes = routesF();

app.use(koaCors({ allowMethods: 'GET,POST' }));
app.use(koaBody({
  urlencoded: true,
  multipart: true,
  parsedMethods: ['POST', 'GET'],
  json: true,
  jsonLimit: '50mb',
  textLimit: '50mb',
}));

/**
 * The main middleware. It's called it on each request, gives an access to our DB.
 * Then calls next() due to the route
 */
app.use(async (ctx, next) => {
  // eslint-disable-next-line consistent-return
  async function run() {
    console.log('In');
    const client = new MongoClient(MONGO_URL, { useUnifiedTopology: true });
    try {
      await client.connect();
      console.log('Connected correctly to server');
      const db = client.db(dbName);
      ctx.state.dbFiles = client.db(filesDB);

      const col = db.collection('notes');
      // Save col in ctx.state for sending it to middlewares
      ctx.state.col = col;
      const res = await next();
      return res;
    } catch (err) {
      console.log(err.stack);
    } finally {
      let type = null;
      if (ctx.request.url === prefix + routes.update) {
        type = JSON.parse(ctx.request.body).type;
      }
      if (!type || type === 'text') {
        await client.close();
        console.log('Closed!');
      }
    }
  }

  // eslint-disable-next-line no-return-assign
  const result = await run().catch(console.dir);
  console.log(result);
  ctx.response.body = JSON.stringify(result);
});

// /**
//  * Service function. Returns an array of users
//  * @param col
//  * @returns {Promise<*>}
//  */
// async function getUsers(col) {
//   const data = await col.find().toArray();
//   return data.map((item) => {
//     const { name } = item;
//     return name;
//   });
// }

/**
 * Middleware to add a note
 */
router.post(routes.update, async (ctx) => {
  console.log('middleware');
  const { col, dbFiles } = ctx.state;
  try {
    const { body } = ctx.request;
    const obj = JSON.parse(body);
    if (obj.type === 'text') {
      await col.insertOne({
        id: obj.id, name: obj.name, type: obj.type, content: obj.content,
      });
    } else {
      await col.insertOne({
        id: obj.id, name: obj.name, type: obj.type,
      });
      const fileBuffer = Buffer.from(obj.content, 'base64');
      const readStream = Readable.from(fileBuffer);
      const bucket = new GridFSBucket(dbFiles);
      const uploadStream = bucket.openUploadStream(obj.id);
      readStream.pipe(uploadStream);

      await new Promise((resolve, reject) => {
        readStream.on('end', () => {
          console.log('Reading ended!');
          resolve();
        });
        uploadStream.on('close', () => {
          console.log('Stream closed!');
          readStream.destroy();
          resolve();
        });
        readStream.on('error', (e) => {
          console.log('Error!', e.message);
          reject();
        });
      });
    }
    return { status: 'Added', data: body };
  } catch (e) {
    return { status: 'Not added', data: e.message };
  }
});
//
// /**
//  * Middleware to delete a user. It's also possible to drop the whole DB.
//  * Use it only to fix the errors!
//  */
// router.post(routes.deleteUsers, async (ctx) => {
//   const { col } = ctx.state;
//   try {
//     const document = ctx.request.body;
//     if (!document.name) {
//       if (await col.findOne({})) {
//         await col.drop();
//         return { status: 'Removed all', data: '' };
//       }
//       return { status: 'Already all removed', data: '' };
//     }
//     await col.deleteMany({ name: document.name });
//     return { status: 'Removed', data: '' };
//   } catch (e) {
//     return { status: 'Not removed', data: e.message };
//   }
// });
//
/**
 * Middleware to fetch notes
 */
router.get(routes.fetchAll, async (ctx) => {
  const { col } = ctx.state;
  const data = await col.find().toArray();
  return {
    status: 'Fetched',
    data: data.map((note) => {
      const { _id, ...rest } = note;
      if (!note.content) rest.content = 'media';
      return rest;
    }),
  };
});

app.use(router.routes())
  .use(router.allowedMethods());

app.listen(PORT, () => { console.log(`Server is working on ${PORT}`); });
