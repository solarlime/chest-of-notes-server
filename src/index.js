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

async function addToGridFS(body, dbFiles, path, callback = undefined) {
  const bucket = new GridFSBucket(dbFiles, { bucketName });
  const uploadStream = bucket.openUploadStream(body.id);
  const reader = fs.createReadStream(path);
  reader.pipe(uploadStream);
  await new Promise((resolve, reject) => {
    reader.on('error', (err) => reject(err));
    uploadStream.on('close', () => {
      reader.destroy();
      fs.unlink(path, () => console.log(`Raw temporary file ${path} was deleted`));
      if (callback) callback();
      resolve();
    });
  });
}

const MAX_BODY = 50 * 1024 * 1024;
app.use(koaCors({ allowMethods: 'GET,POST' }));
app.use(koaBody({
  urlencoded: true,
  multipart: true,
  parsedMethods: ['POST', 'GET'],
  json: true,
  jsonLimit: MAX_BODY,
  formLimit: MAX_BODY,
  textLimit: MAX_BODY,
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

      // Redirect '.../mongo/fetch/one/xxx' & '.../mongo/fetch/one/xxx' to middlewares
      if (ctx.request.url.includes(prefix + routes.fetchOne)) {
        redirectTo(routes.fetchOne);
      } else if (ctx.request.url.includes(prefix + routes.delete)) {
        redirectTo(routes.delete);
      }
      const res = await next();
      console.log(res);
      return res;
    } catch (err) {
      console.log(err.stack);
    } finally {
      // Streams don't allow to close connection normally. Fix it for JSONs
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
    const { body, files } = ctx.request;
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
      // Different browsers record and play media with various types.
      // It's necessary to store them in the only one type.
      // Ffmpeg uses a ffmpeg library in a system to make mp4 files. Then they're put to GridFS.
      // Safari records in mp4 by default, so it isn't necessary to convert a file.
      if (files.content.type.includes('mp4')) {
        await addToGridFS(body, dbFiles, files.content.path);
      } else {
        // eslint-disable-next-line new-cap
        const process = new ffmpeg(files.content.path);
        process.then((blob) => {
          const path = `/tmp/${body.id}.mp4`;
          blob.save(path, async (e, file) => {
            if (!e) {
              console.log(`Result: ${file}`);
              await addToGridFS(body, dbFiles, path, () => { fs.unlink(path, () => console.log(`Converted temporary file ${path} was deleted`)); });
            }
          });
        }, (error) => console.log(`Error: ${error}`));
      }
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
    // Thanks to Ashley Davis for a solution with Safari
    // https://blog.logrocket.com/streaming-video-in-safari/
    const options = {};

    let start;
    let end;

    const { range } = ctx.request.headers;

    // At first, parse the range header
    if (range) {
      const bytesPrefix = 'bytes=';
      if (range.startsWith(bytesPrefix)) {
        const bytesRange = range.substring(bytesPrefix.length);
        const parts = bytesRange.split('-');
        if (parts.length === 2) {
          const rangeStart = parts[0] && parts[0].trim();
          if (rangeStart && rangeStart.length > 0) {
            start = parseInt(rangeStart, 10);
            options.start = start;
          }
          const rangeEnd = parts[1] && parts[1].trim();
          if (rangeEnd && rangeEnd.length > 0) {
            end = parseInt(rangeEnd, 10);
            options.end = end;
          }
        }
      }
    }

    const { col, dbFiles, fileId } = ctx.state;
    const object = await col.findOne({ id: fileId });
    const bucket = new GridFSBucket(dbFiles, { bucketName });
    const downloadStream = bucket.openDownloadStreamByName(fileId);
    ctx.response.type = `${object.type}/mp4`;

    // Determine the file length
    const contentLength = await bucket.find({ filename: fileId }).toArray()
      .then((array) => array[0].length);

    // A HEAD request should be worked with
    if (ctx.request.method === 'HEAD') {
      ctx.response.status = 200;
      ctx.response.set('Accept-Ranges', 'Bytes');
      ctx.response.set('Content-Length', contentLength);
      return null;
    }
    // Determine the content length based on the portion of the file requested
    let retrievedLength;
    if (start !== undefined && end !== undefined) {
      retrievedLength = (end + 1) - start;
    } else if (start !== undefined) {
      retrievedLength = contentLength - start;
    } else if (end !== undefined) {
      retrievedLength = (end + 1);
    } else {
      retrievedLength = contentLength;
    }

    // If a file is full, send 200. Else - 206
    ctx.response.status = (start !== undefined || end !== undefined) ? 206 : 200;
    ctx.response.set('Content-Length', retrievedLength);
    if (range !== undefined) {
      ctx.response.set('Content-Range', `bytes ${start || 0}-${end || (contentLength - 1)}/${contentLength}`);
      ctx.response.set('Accept-Ranges', 'bytes');
    }

    ctx.response.body = downloadStream;
    return null;
  } catch (e) {
    return { status: 'Not fetched', data: e.message };
  }
});

app.use(router.routes())
  .use(router.allowedMethods());

app.listen(PORT, () => { console.log(`Server is working on ${PORT}`); });
