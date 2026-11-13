// Shared by the private worker and the public site's authentication boundary.
export async function requestMessage(origin,path,body,timestamp,nonce){
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)));
  return new TextEncoder().encode(['GOODSHOT automation v1',origin,'POST',path,String(timestamp),nonce,Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('')].join('\n'));
}
