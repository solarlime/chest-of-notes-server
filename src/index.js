const dotenv = require('dotenv');
const Koa = require('koa');
const Router = require('@koa/router');
const koaBody = require('koa-body');
const koaCors = require('@koa/cors');
const { MongoClient, GridFSBucket } = require('mongodb');
const ffmpeg = require('ffmpeg');
const fs = require('fs');

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
const bucketName = prefix.replace('/', '').replace(/-/g, '_');

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

      // eslint-disable-next-line no-inner-declarations
      function redirectTo(target) {
        ctx.state.fileId = ctx.request.url.replace(`${prefix + target}/`, '');
        ctx.request.url = prefix + target;
      }

      if (ctx.request.url.includes(prefix + routes.fetchOne)) {
        redirectTo(routes.fetchOne);
      } else if (ctx.request.url.includes(prefix + routes.delete)) {
        redirectTo(routes.delete);
      }
      const res = await next();
      return res;
    } catch (err) {
      console.log(err.stack);
    } finally {
      let type = null;
      if ((ctx.request.url === prefix + routes.update)
          || (ctx.request.url.includes(routes.fetchOne))) {
        type = 'media';
      }
      if (!type || type === 'text') {
        await client.close();
        console.log('Closed!');
      }
    }
  }

  // eslint-disable-next-line no-return-assign
  const result = await run().catch(console.dir);
  if (result) ctx.response.body = JSON.stringify(result);
});

/**
 * Middleware to add a note
 */
router.post(routes.update, async (ctx) => {
  console.log('middleware');
  const { col, dbFiles } = ctx.state;
  try {
    const { body } = ctx.request;
    const { files } = ctx.request;
    if (body.type === 'text') {
      await col.insertOne({
        id: body.id, name: body.name, type: body.type, content: body.content,
      });
      return { status: 'Added', data: body.id };
    }
    await col.insertOne({
      id: body.id, name: body.name, type: body.type,
    });
    try {
      // eslint-disable-next-line new-cap
      const process = new ffmpeg(files.content.path);
      process.then((blob) => {
        const path = `/tmp/${body.id}.mp4`;
        blob.save(path, async (e, file) => {
          if (!e) {
            console.log(`Result: ${file}`);
            const bucket = new GridFSBucket(dbFiles, { bucketName });
            const uploadStream = bucket.openUploadStream(body.id);
            const reader = fs.createReadStream(path);
            reader.pipe(uploadStream);
            await new Promise((resolve, reject) => {
              reader.on('error', (err) => reject(err));
              uploadStream.on('close', () => {
                reader.destroy();
                fs.unlink(path, () => console.log(`Temporary file ${path} was deleted`));
                resolve();
              });
            });
          }
        });
      }, (error) => console.log(`Error: ${error}`));
    } catch (e) {
      throw Error(e.message);
    }
    return { status: 'Added', data: body.id };
  } catch (e) {
    return { status: 'Not added', data: e.message };
  }
});

/**
 * Middleware to delete notes
 */
router.get(routes.delete, async (ctx) => {
  try {
    const { col, dbFiles, fileId } = ctx.state;
    const object = await col.findOne({ id: fileId });
    if (object.type !== 'text') {
      const bucket = new GridFSBucket(dbFiles, { bucketName });
      const file = await dbFiles.collection(`${bucketName}.files`).findOne({ filename: fileId });
      // eslint-disable-next-line no-underscore-dangle
      await bucket.delete(file._id);
    }
    await col.deleteOne({ id: fileId });
    return { status: 'Deleted', data: fileId };
  } catch (e) {
    return { status: 'Not deleted', data: e.message };
  }
});

/**
 * Middleware to fetch notes
 */
router.get(routes.fetchAll, async (ctx) => {
  try {
    const { col } = ctx.state;
    const data = await col.find().toArray();
    return {
      status: 'Fetched',
      data: data.map((note) => {
        const { _id, ...rest } = note;
        if (!note.content && note.type !== 'text') rest.content = 'media';
        return rest;
      }),
    };
  } catch (e) {
    return { status: 'Not fetched' };
  }
});

router.get(routes.fetchOne, async (ctx) => {
  try {
    const { dbFiles, fileId } = ctx.state;
    const bucket = new GridFSBucket(dbFiles, { bucketName });
    const downloadStream = bucket.openDownloadStreamByName(fileId);
    ctx.response.body = downloadStream;
    return null;
  } catch (e) {
    return { status: 'Not fetched', data: e.message };
  }
});

app.use(router.routes())
  .use(router.allowedMethods());

app.listen(PORT, () => { console.log(`Server is working on ${PORT}`); });
