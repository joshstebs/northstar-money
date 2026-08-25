import {NextResponse} from 'next/server';
export async function GET(){return NextResponse.json({summary:'Dining is above baseline and recurring services should be reviewed.',potentialMonthlySavings:612,actions:[{title:'Dining reset',amount:169},{title:'Subscription review',amount:63},{title:'Extra credit-card payment',amount:250}]})}
