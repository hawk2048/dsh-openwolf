// walkthrough helper: log a bug into the fixture brain
import { WolfBrain } from '../lib/brain.js'
const brain = new WolfBrain(process.argv[2] ?? '.', '.wolf')
await brain.logBug('ECONNREFUSED', 'added retry')
console.log('bug logged')
