import {passwordHash} from '../api/auth.js'
let input=''
for await(const chunk of process.stdin)input+=chunk
const password=input.replace(/\r?\n$/,'')
if(password.length<16||password.length>1024)throw new Error('Use a password of 16–1024 characters')
console.log(passwordHash(password))
