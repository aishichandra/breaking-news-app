// Empties the articles collection. Destructive and irreversible, so it
// refuses to run without an explicit --yes.
//
//   npm run reset            show what would be deleted
//   npm run reset -- --yes   actually delete it
import { MongoClient } from 'mongodb'

const client = new MongoClient(process.env.MONGODB_URI)
await client.connect()

const collection = client.db('breaking_news').collection('articles')
const count = await collection.countDocuments()

if (!process.argv.includes('--yes')) {
  console.log(`${count} article(s) in breaking_news.articles`)
  console.log('This would delete ALL of them. To confirm, run:')
  console.log('  npm run reset -- --yes')
  await client.close()
  process.exit(1)
}

const { deletedCount } = await collection.deleteMany({})
console.log(`Deleted ${deletedCount} article(s). Collection is now empty.`)
await client.close()
