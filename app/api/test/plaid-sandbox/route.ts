import {NextRequest,NextResponse} from 'next/server';
import {Products} from 'plaid';
import {db,ownerUser} from '@/lib/db';
import {plaidClient} from '@/lib/providers/plaid';
import {encryptSecret} from '@/lib/security/crypto';
import {syncPlaidConnection} from '@/lib/finance/sync-plaid';

export const dynamic='force-dynamic';

const TEST_TOKEN='eDLZS6xHx0TLr8Lv40ielzBrkboU4Zfn';
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

export async function GET(req:NextRequest){
  const plaidEnv=process.env.PLAID_ENV??'sandbox';
  if(process.env.VERCEL_ENV!=='production'||plaidEnv!=='sandbox'){
    return NextResponse.json({error:'sandbox production probe disabled',plaidEnvironment:plaidEnv},{status:404});
  }
  if(req.nextUrl.searchParams.get('token')!==TEST_TOKEN){
    return NextResponse.json({error:'unauthorized'},{status:401});
  }
  if(!process.env.PLAID_CLIENT_ID||!process.env.PLAID_SECRET){
    return NextResponse.json({error:'Plaid sandbox credentials are not configured in Production'},{status:503});
  }

  const startedAt=new Date();
  const client=plaidClient();
  let accessToken:string|undefined;
  let connectionId:string|undefined;

  try{
    await ownerUser();
    const webhook=process.env.APP_URL?`${process.env.APP_URL.replace(/\/$/,'')}/api/plaid/webhook`:undefined;
    const publicTokenResponse=await client.sandboxPublicTokenCreate({
      institution_id:'ins_109508',
      initial_products:[Products.Transactions],
      options:{
        override_username:'user_transactions_dynamic',
        override_password:'northstar-test',
        ...(webhook?{webhook}:{})
      }
    } as any);

    const exchange=await client.itemPublicTokenExchange({public_token:publicTokenResponse.data.public_token});
    accessToken=exchange.data.access_token;
    const itemId=exchange.data.item_id;

    const connection=await db.connection.upsert({
      where:{provider_providerItemId:{provider:'plaid',providerItemId:itemId}},
      update:{encryptedAccessToken:encryptSecret(accessToken),institutionName:'Plaid Sandbox — First Platypus Bank',status:'active',lastError:null},
      create:{userId:'owner',provider:'plaid',providerItemId:itemId,encryptedAccessToken:encryptSecret(accessToken),institutionName:'Plaid Sandbox — First Platypus Bank'}
    });
    connectionId=connection.id;
    await db.auditLog.create({data:{userId:'owner',action:'connection_created',provider:'plaid',details:'sandbox acceptance test'}});

    const firstSync=await syncPlaidConnection(connection.id);
    const accountCount=await db.account.count({where:{connectionId:connection.id}});
    const transactionCount=await db.transaction.count({where:{account:{connectionId:connection.id}}});
    const secondSync=await syncPlaidConnection(connection.id);

    let webhookFired=false;
    try{
      const fired=await client.sandboxItemFireWebhook({access_token:accessToken,webhook_code:'SYNC_UPDATES_AVAILABLE'} as any);
      webhookFired=Boolean(fired.data.webhook_fired);
      await sleep(2500);
    }catch{}

    const syncAuditCount=await db.auditLog.count({where:{userId:'owner',provider:'plaid',action:'sync_complete',createdAt:{gte:startedAt}}});

    return NextResponse.json({
      ok:true,
      environment:plaidEnv,
      institution:'First Platypus Bank',
      testUser:'user_transactions_dynamic',
      firstSync,
      persisted:{accounts:accountCount,transactions:transactionCount},
      secondSync,
      idempotent:secondSync.added===0&&secondSync.modified===0&&secondSync.removed===0,
      webhookFired,
      syncAuditCount,
      cleanup:'automatic'
    },{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:'sandbox acceptance test failed'},{status:500});
  }finally{
    if(connectionId){
      await db.connection.delete({where:{id:connectionId}}).catch(()=>{});
    }
    if(accessToken){
      await client.itemRemove({access_token:accessToken}).catch(()=>{});
    }
  }
}
