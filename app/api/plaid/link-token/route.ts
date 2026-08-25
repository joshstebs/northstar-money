import {NextResponse} from 'next/server';import {makeLinkToken} from '@/lib/providers/plaid';
export async function POST(){try{const t=await makeLinkToken();return NextResponse.json(t?{link_token:t}:{link_token:null,mode:'configuration-required'});}catch{return NextResponse.json({error:'Unable to create Plaid Link token'},{status:500})}}
