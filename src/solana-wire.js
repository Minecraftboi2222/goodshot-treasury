import bs58 from 'bs58';
import {ed25519} from '@noble/curves/ed25519';
const invalid=()=>{throw new Error('Invalid signed automation transaction');};
// The automation service deliberately builds legacy transactions without lookup tables.
export function decodeSigned(raw,expectedSigner){
  let bytes;try{bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));}catch{invalid();}if(bytes.length>1232)invalid();
  let at=0;const read=n=>{if(at+n>bytes.length)invalid();const v=bytes.slice(at,at+n);at+=n;return v;};
  const compact=()=>{let n=0,shift=0,b;do{b=read(1)[0];n|=(b&127)<<shift;shift+=7;if(shift>21)invalid();}while(b&128);return n;};
  const count=compact();if(count!==1)invalid();const signature=read(64),messageAt=at,versioned=bytes[at]===128;if(versioned)read(1);const header=read(3);if(header[0]!==1)invalid();
  const keys=Array.from({length:compact()},()=>bs58.encode(read(32)));if(keys[0]!==expectedSigner)invalid();
  const blockhash=bs58.encode(read(32)),instructions=[];
  for(let n=compact();n;n--){const programIndex=read(1)[0],indexes=read(compact()),data=read(compact());if(!versioned&&(!keys[programIndex]||Array.from(indexes).some(i=>!keys[i])))invalid();instructions.push({program:keys[programIndex]||'lookup',accounts:Array.from(indexes,i=>keys[i]||'lookup'),data});}
  if(versioned)for(let n=compact();n;n--){read(32);read(compact());read(compact());}
  if(at!==bytes.length||!ed25519.verify(signature,bytes.slice(messageAt),bs58.decode(expectedSigner)))invalid();
  return {signature:bs58.encode(signature),blockhash,instructions,versioned};
}
const SYSTEM='11111111111111111111111111111111',COMPUTE='ComputeBudget111111111111111111111111111111',MEMO='MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export function validatePayoutWire(tx,roundId,wallet,payouts){
  if(tx.versioned)throw new Error('Winner transfers must use the fixed legacy payout format');
  const expected=new Map(payouts.map(p=>[p.wallet,BigInt(p.amount)])),sent=new Map();let memo=false;
  for(const i of tx.instructions){
    const v=new DataView(i.data.buffer,i.data.byteOffset,i.data.byteLength);
    if(i.program===COMPUTE){if(i.data[0]===2&&i.data.length===5&&v.getUint32(1,true)<=200000)continue;if(i.data[0]===3&&i.data.length===9&&v.getBigUint64(1,true)<=100000n)continue;throw new Error('Unsupported compute budget');}
    if(i.program===MEMO&&new TextDecoder().decode(i.data)==='goodshot:payout:'+roundId){if(memo)throw new Error('Duplicate payout memo');memo=true;continue;}
    if(i.program!==SYSTEM||i.data.length!==12||v.getUint32(0,true)!==2||i.accounts.length!==2||i.accounts[0]!==wallet)throw new Error('Unexpected payout instruction');
    const to=i.accounts[1];if(sent.has(to))throw new Error('Duplicate winner transfer');sent.set(to,v.getBigUint64(4,true));
  }
  if(!memo||sent.size!==expected.size||[...expected].some(([k,v])=>sent.get(k)!==v))throw new Error('Payout does not match the settled round');
}
