import {API} from './api.js'
export const judgeSettings=$state({loaded:false,configured:false,automatic:false,model:'',error:''})
let loading
export function loadJudgeSettings(){return loading??=fetch(`${API}/api/judge/settings`).then(async r=>{if(!r.ok)throw Error('Could not load judge settings');Object.assign(judgeSettings,await r.json(),{loaded:true,error:''})}).catch(e=>{judgeSettings.error=e.message;loading=null})}
