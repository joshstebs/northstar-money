import {cookies} from 'next/headers';import {authConfigured,SESSION_COOKIE,verifySessionToken} from './auth';
export async function hasSession(){if(!authConfigured())return false;return verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value)}
export async function requireSession(){if(!authConfigured())return {ok:false as const,status:503,error:'Private authentication is not configured.'};if(!(await hasSession()))return {ok:false as const,status:401,error:'Unauthorized'};return {ok:true as const}}
