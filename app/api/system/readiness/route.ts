import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {requireSession} from '@/lib/security/request-auth';

export const dynamic='force-dynamic';

function present(name:string){return Boolean(process.env[name]?.trim())}

export async function GET(){
  const auth=await requireSession();
  if(!auth.ok)return NextResponse.json({error:auth.error},{status:auth.status});

  let database='unavailable';
  let migration:string|null=null;
  try{
    await db.$queryRaw`SELECT 1`;
    database='ok';
    const rows=await db.$queryRawUnsafe<Array<{migration_name:string}>>('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC LIMIT 1');
    migration=rows[0]?.migration_name??null;
  }catch{}

  const plaid=present('PLAID_CLIENT_ID')&&present('PLAID_SECRET');
  const flinks=['FLINKS_INSTANCE','FLINKS_CUSTOMER_ID','FLINKS_AUTH_KEY','FLINKS_API_SECRET','FLINKS_BASE_URL'].every(present);

  const checks={
    database,
    migration,
    auth:present('APP_AUTH_SECRET')&&present('APP_AUTH_PASSWORD_HASH'),
    encryption:present('APP_ENCRYPTION_KEY'),
    appUrl:present('APP_URL'),
    cron:present('CRON_SECRET'),
    providers:{plaid,flinks},
    ai:present('OPENAI_API_KEY'),
    plaidEnvironment:process.env.PLAID_ENV??'sandbox'
  };

  return NextResponse.json({
    ok:database==='ok'&&checks.auth&&checks.encryption&&checks.appUrl&&checks.cron&&(plaid||flinks),
    checks
  },{headers:{'Cache-Control':'no-store'}});
}
