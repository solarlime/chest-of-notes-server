const dotenv = require('dotenv');
const Koa = require('koa');
const Router = require('@koa/router');
const koaBody = require('koa-body');
const koaCors = require('@koa/cors');
const { MongoClient } = require('mongodb');

/**
 * Make a serverless function with Koa
 * @type {Application}
 */

dotenv.config();
const app = new Koa();
const router = new Router();
const url = process.env.MONGO_URL;
const dbName = 'chest-of-notes';
const PORT = 3001;

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
}));

/**
 * The main middleware. It's called it on each request, gives an access to our DB.
 * Then calls next() due to the route
 */
app.use(async (ctx, next) => {
  // eslint-disable-next-line consistent-return
  async function run() {
    console.log('In');
    console.log('url is ', url);
    const client = new MongoClient(url, { useUnifiedTopology: true });
    try {
      await client.connect();
      console.log('Connected correctly to server');
      const db = client.db(dbName);

      const col = db.collection('notes');
      // Save col in ctx.state for sending it to middlewares
      ctx.state.col = col;
      const res = await next();
      return res;
    } catch (err) {
      console.log(err.stack);
    } finally {
      await client.close();
      console.log('Closed!');
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
  const { col } = ctx.state;
  try {
    const document = JSON.parse(ctx.request.body);
    await col.insertOne({
      id: document.id, name: document.name, type: document.type, content: document.content,
    });
    return { status: 'Added', data: document };
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
// /**
//  * Middleware to return users. A wrapper for getUsers
//  */
// router.get(routes.fetchUsers, async (ctx) => {
//   const { col } = ctx.state;
//   return {
//     status: 'Fetched',
//     data: await getUsers(col),
//   };
// });

app.use(router.routes())
  .use(router.allowedMethods());

app.listen(PORT, () => { console.log(`Server is working on ${PORT}`) });
