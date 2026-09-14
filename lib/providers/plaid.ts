import {createHash,createPublicKey,timingSafeEqual,verify as verifySignature} from 'node:crypto';
import {Configuration,PlaidApi,PlaidEnvironments,Products,CountryCode} from 'plaid';

export function plaidClient(){
  const env=process.env.PLAID_ENV==='production'?PlaidEnvironments.production:process.env.PLAID_ENV==='development'?PlaidEnvironments.development:PlaidEnvironments.sandbox;
  return new PlaidApi(new Configuration({basePath:env,baseOptions:{headers:{'PLAID-CLIENT-ID':process.env.PLAID_CLIENT_ID,'PLAID-SECRET':process.env.PLAID_SECRET}}}));
}

export async function makeLinkToken(){
  if(!process.env.PLAID_CLIENT_ID||!process.env.PLAID_SECRET)return null;
  const webhook=process.env.APP_URL?`${process.env.APP_URL.replace(/\/$/,'')}/api/plaid/webhook`:undefined;
  const r=await plaidClient().linkTokenCreate({user:{client_user_id:'owner'},client_name:'Northstar Money',products:[Products.Transactions],country_codes:[CountryCode.Ca],language:'en',webhook,transactions:{days_requested:730}});
  return r.data.link_token;
}

type PlaidWebhookJwtHeader={alg?:string;kid?:string};
type PlaidWebhookJwtPayload={iat?:number;request_body_sha256?:string};
const webhookKeys=new Map<string,Record<string,unknown>>();

function decodeJwtPart<T>(part:string):T{
  return JSON.parse(Buffer.from(part,'base64url').toString('utf8')) as T;
}

export async function verifyPlaidWebhook(rawBody:string,signedJwt:string|null|undefined){
  if(!signedJwt||!process.env.PLAID_CLIENT_ID||!process.env.PLAID_SECRET)return false;
  const parts=signedJwt.split('.');
  if(parts.length!==3)return false;

  let header:PlaidWebhookJwtHeader;
  let payload:PlaidWebhookJwtPayload;
  try{
    header=decodeJwtPart<PlaidWebhookJwtHeader>(parts[0]);
    payload=decodeJwtPart<PlaidWebhookJwtPayload>(parts[1]);
  }catch{return false}

  if(header.alg!=='ES256'||typeof header.kid!=='string'||!header.kid)return false;
  if(typeof payload.iat!=='number'||typeof payload.request_body_sha256!=='string')return false;
  const now=Math.floor(Date.now()/1000);
  if(payload.iat<now-300||payload.iat>now+300)return false;

  let jwk=webhookKeys.get(header.kid);
  if(!jwk){
    try{
      const response=await plaidClient().webhookVerificationKeyGet({key_id:header.kid});
      const key=response.data.key as unknown as Record<string,unknown>;
      if(key.alg!=='ES256'||key.kty!=='EC'||key.crv!=='P-256'||key.kid!==header.kid)return false;
      jwk=key;
      webhookKeys.set(header.kid,key);
    }catch{return false}
  }

  try{
    const key=createPublicKey({key:jwk,format:'jwk'} as any);
    const signature=Buffer.from(parts[2],'base64url');
    const signed=Buffer.from(`${parts[0]}.${parts[1]}`);
    if(!verifySignature('sha256',signed,{key,dsaEncoding:'ieee-p1363'},signature))return false;
  }catch{return false}

  const actualHash=createHash('sha256').update(rawBody).digest('hex');
  const expectedHash=payload.request_body_sha256;
  const actual=Buffer.from(actualHash,'utf8');
  const expected=Buffer.from(expectedHash,'utf8');
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
