import {Connection,PublicKey,Keypair,Transaction,TransactionMessage,VersionedTransaction,SystemProgram,ComputeBudgetProgram,TransactionInstruction} from '@solana/web3.js';
import {createRequire} from 'node:module';
// SDK's CJS entry resolves Anchor/agent-payments correctly under Node 22/24.
const {OnlinePumpSdk,PUMP_SDK,PUMP_FEE_PROGRAM_ID,feeSharingConfigPda,normalizeQuoteMint}=createRequire(import.meta.url)('@pump-fun/pump-sdk');
import {NATIVE_MINT,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {ed25519} from '@noble/curves/ed25519';
import bs58 from 'bs58';
import {requestMessage} from './protocol.js';
import {decodeSigned,validatePayoutWire} from '../src/solana-wire.js';
const MEMO=new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const fail=message=>new Error('GOODSHOT: '+message);
export function keypairFromSecret(value){try{const s=value.trim(),bytes=s.startsWith('[')?Uint8Array.from(JSON.parse(s)):bs58.decode(s);if(bytes.length===32)return Keypair.fromSeed(bytes);if(bytes.length===64)return Keypair.fromSecretKey(bytes);}catch{}throw fail('Invalid treasury secret. Use a 32-byte seed or a 64-byte Solana keypair.');}
export function checkShares(sharing,mint,developer,treasury){
  if(sharing.mint.toBase58()!==mint||sharing.shareholders.length!==2||developer===treasury)throw fail('The mint must have exactly two configured shareholders.');
  const shares=new Map(sharing.shareholders.map(s=>[s.address.toBase58(),s.shareBps]));
  if(shares.get(developer)!==7000||shares.get(treasury)!==3000)throw fail('Pump distribution must be 70% donation wallet and 30% game treasury.');
}
export class TreasuryService{
  constructor({origin,keypair,rpcUrl,connection,api,lookupTable,minClaim=1000000n,gasReserve=20000000n}){
    this.origin=new URL(origin).origin;this.keypair=keypair;this.wallet=keypair.publicKey.toBase58();this.lookupTable=lookupTable;this.minClaim=BigInt(minClaim);this.gasReserve=BigInt(gasReserve);this.connection=connection||new Connection(rpcUrl,{commitment:'finalized',disableRetryOnRateLimit:true,fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})});this.pump=new OnlinePumpSdk(this.connection);this.api=api||this.request.bind(this);this.lastClaim=0;this.checkedNetwork=false;
  }
  async request(action,data={}){
    const path='/api/automation/'+action,body=JSON.stringify(data),timestamp=String(Date.now()),nonce=crypto.randomUUID(),message=await requestMessage(this.origin,path,body,timestamp,nonce);
    const r=await fetch(this.origin+path,{method:'POST',headers:{'content-type':'application/json','x-goodshot-timestamp':timestamp,'x-goodshot-nonce':nonce,'x-goodshot-signature':bs58.encode(ed25519.sign(message,this.keypair.secretKey.slice(0,32)))},body,signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw fail(r.status===503?'Waiting for the token mint and treasury activation.':'The game treasury API rejected a request.');return r.json();
  }
  async signed(instructions,kind,roundId){
    const latest=await this.connection.getLatestBlockhash('finalized'),budget=[ComputeBudgetProgram.setComputeUnitLimit({units:kind==='payout'?200000:1200000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:1000})];
    let tx;
    if(kind==='claim'&&this.lookupTable){const result=await this.connection.getAddressLookupTable(new PublicKey(this.lookupTable));if(!result.value)throw fail('The configured claim lookup table was not found.');tx=new VersionedTransaction(new TransactionMessage({payerKey:this.keypair.publicKey,recentBlockhash:latest.blockhash,instructions:[...budget,...instructions]}).compileToV0Message([result.value]));tx.sign([this.keypair]);}
    else{tx=new Transaction({feePayer:this.keypair.publicKey,blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight}).add(...budget,...instructions);tx.sign(this.keypair);}
    let raw;try{raw=Buffer.from(tx.serialize()).toString('base64');}catch{throw fail('Claim transaction needs an address lookup table; configure CLAIM_LOOKUP_TABLE before enabling claims.');}
    const decoded=decodeSigned(raw,this.wallet);if(kind==='payout')validatePayoutWire(decoded,roundId,this.wallet,instructions.filter(i=>i.programId.equals(SystemProgram.programId)).map(i=>({wallet:i.keys[1].pubkey.toBase58(),amount:i.data.readBigUInt64LE(4).toString()})));
    const fee=await this.connection.getFeeForMessage(tx instanceof VersionedTransaction?tx.message:tx.compileMessage(),'finalized');if(fee.value===null||fee.value>50000)throw fail('Network fee is unavailable or above the 0.00005 SOL limit.');
    return {kind,roundId,signedTransaction:raw,signature:decoded.signature,blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight};
  }
  async resume(job){
    if(job.status&&job.status!=='prepared')return job.status;
    const before=await this.api('resolve',{id:job.id});if(before.status!=='prepared')return before.status;
    // Broadcast only the bytes already committed to the site's durable outbox.
    try{await this.connection.sendRawTransaction(Buffer.from(job.signedTransaction,'base64'),{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0});}catch{/* A timeout may mean accepted. Keep this exact signature until resolved. */}
    return (await this.api('resolve',{id:job.id})).status;
  }
  async cycle(){
    const work=await this.api('work');if(work.config.treasuryWallet!==this.wallet)throw fail('The signer does not match the configured game treasury.');
    if(!this.checkedNetwork){if(await this.connection.getGenesisHash()!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')throw fail('The RPC must connect to Solana mainnet-beta.');this.checkedNetwork=true;}
    if(work.active)return this.resume({...work.active,status:'prepared'});
    const balance=BigInt(await this.connection.getBalance(this.keypair.publicKey,'finalized'));
    if(balance<BigInt(work.liability)+this.gasReserve)throw fail('Treasury needs its separate SOL gas reserve topped up. Prize allocations are not spent on gas.');
    if(work.round){
      const payouts=work.round.payouts.filter(p=>!p.paymentSignature),sum=payouts.reduce((n,p)=>n+BigInt(p.amount),0n);
      if(sum>BigInt(work.round.amount)||payouts.length>3||new Set(payouts.map(p=>p.wallet)).size!==payouts.length)throw fail('Invalid round award; no payment signed.');
      const instructions=payouts.map(p=>SystemProgram.transfer({fromPubkey:this.keypair.publicKey,toPubkey:new PublicKey(p.wallet),lamports:BigInt(p.amount)}));instructions.push(new TransactionInstruction({programId:MEMO,keys:[],data:Buffer.from('goodshot:payout:'+work.round.id)}));
      const prepared=await this.signed(instructions,'payout',work.round.id),job=await this.api('prepare',{id:'payout:'+work.round.id,...prepared});return this.resume(job);
    }
    if(Date.now()-this.lastClaim<60000)return 'idle';this.lastClaim=Date.now();
    const mint=new PublicKey(work.mint),sharingAddress=feeSharingConfigPda(mint),account=await this.connection.getAccountInfo(sharingAddress,'finalized');
    if(!account||!account.owner.equals(PUMP_FEE_PROGRAM_ID))throw fail('Configure the Pump creator distribution before enabling automatic claims.');
    checkShares(PUMP_SDK.decodeSharingConfig(account),work.mint,work.config.developerWallet,this.wallet);
    const curve=await this.pump.fetchBondingCurve(mint);if(!normalizeQuoteMint(curve.quoteMint).equals(NATIVE_MINT))throw fail('Only SOL-paired creator fees are supported.');
    const info=await this.pump.getMinimumDistributableFee(mint,this.keypair.publicKey,{quoteMint:NATIVE_MINT,quoteTokenProgram:TOKEN_PROGRAM_ID,payer:this.keypair.publicKey});
    if(!info.canDistribute||BigInt(info.distributableFees.toString())<this.minClaim)return 'idle';
    const built=await this.pump.buildDistributeCreatorFeesInstructions(mint,{quoteMint:NATIVE_MINT,quoteTokenProgram:TOKEN_PROGRAM_ID,payer:this.keypair.publicKey}),prepared=await this.signed(built.instructions,'claim');
    const job=await this.api('prepare',{id:work.claimId,...prepared});return this.resume(job);
  }
}
