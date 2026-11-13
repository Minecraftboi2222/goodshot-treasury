import {readFile} from 'node:fs/promises';
import {TreasuryService,keypairFromSecret} from './service.mjs';
let stopped=false;process.on('SIGTERM',()=>{stopped=true;});process.on('SIGINT',()=>{stopped=true;});
try{
  const origin=process.env.GOODSHOT_ORIGIN||'https://playgoodshot.fun',url=new URL(origin);
  if(url.protocol!=='https:'&&!(['127.0.0.1','localhost'].includes(url.hostname)&&process.env.ALLOW_LOCAL_QA==='1'))throw new Error('GOODSHOT: HTTPS is required for the game endpoint.');
  if(!process.env.SOLANA_RPC_URL)throw new Error('GOODSHOT: Configure a mainnet RPC URL in the private service.');
  const secret=process.env.TREASURY_KEYPAIR_PATH?await readFile(process.env.TREASURY_KEYPAIR_PATH,'utf8'):process.env.TREASURY_SECRET_KEY;
  if(!secret)throw new Error('GOODSHOT: Configure the treasury signer privately on this server.');
  const service=new TreasuryService({origin,keypair:keypairFromSecret(secret),rpcUrl:process.env.SOLANA_RPC_URL,lookupTable:process.env.CLAIM_LOOKUP_TABLE,minClaim:process.env.MIN_CLAIM_LAMPORTS||'1000000',gasReserve:process.env.GAS_RESERVE_LAMPORTS||'20000000'});
  console.log('GOODSHOT treasury service started. Wallet: '+service.wallet);
  while(!stopped){try{const status=await service.cycle();if(!['idle','prepared'].includes(status))console.log('Treasury transaction status: '+status);}catch(e){console.error(e.message?.startsWith('GOODSHOT:')?e.message:'Treasury cycle could not complete; the same pending transaction will be retried.');}if(process.argv.includes('--once'))break;for(let i=0;i<10&&!stopped;i++)await new Promise(r=>setTimeout(r,1000));}
}catch(e){console.error(e.message?.startsWith('GOODSHOT:')?e.message:'Treasury service could not start. Check private server configuration.');process.exitCode=1;}
