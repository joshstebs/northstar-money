import {NextRequest,NextResponse} from 'next/server';import {db,ownerUser} from '@/lib/db';import {requireSession,requireWriteSession} from '@/lib/security/request-auth';
import {parsePlanningInput} from '@/lib/finance/planning';
export async function GET(){const auth=await requireSession();if(!auth.ok)return NextResponse.json({error:auth.error},{status:auth.status});await ownerUser();const [budgets,goals,accounts]=await Promise.all([db.budget.findMany({where:{userId:'owner'},orderBy:{month:'desc'}}),db.goal.findMany({where:{userId:'owner'},orderBy:{targetDate:'asc'}}),db.account.findMany({where:{userId:'owner'},select:{id:true,name:true,type:true,currentBalance:true,interestRate:true,minimumPayment:true}})]);return NextResponse.json({budgets,goals,accounts})}
export async function POST(req: NextRequest) {
  const auth = await requireWriteSession(req);
  if (!auth.ok) return NextResponse.json({error: auth.error}, {status: auth.status});
  let b: ReturnType<typeof parsePlanningInput>;
  try {b = parsePlanningInput(await req.json());}
  catch (error) {return NextResponse.json({error: error instanceof Error ? error.message : 'Invalid planning item'}, {status: 400});}
  try {
    await ownerUser();
    if (b.kind === 'budget') {
      const {category, amount, month} = b;
      const item = await db.budget.upsert({where: {userId_category_month: {userId: 'owner', category, month}}, update: {amount}, create: {userId: 'owner', category, month, amount}});
      return NextResponse.json({ok: true, item});
    }
    if (b.kind === 'goal') {
      const {name, targetAmount, currentAmount, targetDate} = b;
      const data = {name, targetAmount, currentAmount, targetDate};
      const item = b.id ? await db.goal.update({where: {id: b.id, userId: 'owner'}, data}) : await db.goal.create({data: {userId: 'owner', ...data}});
      return NextResponse.json({ok: true, item});
    }
    const item = await db.account.update({where: {id: b.accountId, userId: 'owner'}, data: {interestRate: b.apr, minimumPayment: b.minimumPayment}});
    return NextResponse.json({ok: true, item});
  } catch (error) {
    console.error('Planning update failed', error);
    return NextResponse.json({error: 'Unable to save planning item'}, {status: 500});
  }
}
export async function DELETE(req:NextRequest){const auth=await requireWriteSession(req);if(!auth.ok)return NextResponse.json({error:auth.error},{status:auth.status});const kind=req.nextUrl.searchParams.get('kind'),id=req.nextUrl.searchParams.get('id');if(!id)return NextResponse.json({error:'id required'},{status:400});if(kind==='budget')await db.budget.deleteMany({where:{id,userId:'owner'}});else if(kind==='goal')await db.goal.deleteMany({where:{id,userId:'owner'}});else return NextResponse.json({error:'Unknown kind'},{status:400});return NextResponse.json({ok:true})}

