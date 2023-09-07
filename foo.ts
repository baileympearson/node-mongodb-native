import { MongoClient } from './src';

async function foo() {
  await using client = new MongoClient(process.env.MONGODB_URI);

  await client.connect();
  console.error(await client.db('admin').command({ ping: 1 }));
}

foo();
