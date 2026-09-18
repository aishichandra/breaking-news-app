// Empties the whole dataset -- articles, answers, and manually-set source
// dates -- for a clean-slate restart. All three, not just articles: they're
// separate collections (answers reference article_id, not embedded), so
// clearing articles alone via a raw Mongo delete would leave answers
// orphaned instead of cascading the way DELETE /api/articles/:id does.
// Destructive and irreversible, so it refuses to run without an explicit
// --yes.
//
//   npm run reset            show what would be deleted
//   npm run reset -- --yes   actually delete it
import { MongoClient } from 'mongodb'

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not set. Add it to api/.env before running this.')
  process.exit(1)
}

const client = new MongoClient(process.env.MONGODB_URI)
await client.connect()

const db = client.db('breaking_news')
const collections = ['articles', 'answers', 'sources']
const counts = Object.fromEntries(
  await Promise.all(collections.map(async (name) => [name, await db.collection(name).countDocuments()]))
)

if (!process.argv.includes('--yes')) {
  for (const name of collections) console.log(`${counts[name]} document(s) in breaking_news.${name}`)
  console.log('This would delete ALL of them. To confirm, run:')
  console.log('  npm run reset -- --yes')
  await client.close()
  process.exit(1)
}

for (const name of collections) {
  const { deletedCount } = await db.collection(name).deleteMany({})
  console.log(`Deleted ${deletedCount} document(s) from ${name}.`)
}
await client.close()
