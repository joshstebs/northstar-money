import {NextResponse} from 'next/server';import {getFlinksConnectUrl} from '@/lib/providers/flinks';
export async function POST(){try{const connectUrl=await getFlinksConnectUrl();return NextResponse.json(connectUrl?{connectUrl}:{error:'Flinks credentials are not configured yet.'});}catch{return NextResponse.json({error:'Unable to start Flinks connection'},{status:500})}}
