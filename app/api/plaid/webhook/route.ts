import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {syncPlaidConnection} from '@/lib/finance/sync-plaid';
import {verifyPlaidWebhook} from '@/lib/providers/plaid';

export async function POST(req:NextRequest){
  const rawBody=await req.text();
  const verified=await verifyPlaidWebhook(rawBody,req.headers.get('plaid-verification'));
  if(!verified)return NextResponse.json({error:'Unauthorized'},{status:401});

  let body:any=null;
  try{body=JSON.parse(rawBody)}catch{return NextResponse.json({error:'Invalid JSON'},{status:400})}

  if(body?.webhook_type==='TRANSACTIONS'&&body?.webhook_code==='SYNC_UPDATES_AVAILABLE'&&typeof body.item_id==='string'){
    const c=await db.connection.findUnique({where:{provider_providerItemId:{provider:'plaid',providerItemId:body.item_id}}});
    if(c)await syncPlaidConnection(c.id);
  }
  return NextResponse.json({received:true});
}
