import {redirect} from 'next/navigation';
import {hasSession} from '@/lib/security/request-auth';
import {HouseholdNav} from '@/app/components/HouseholdNav';

export const dynamic = 'force-dynamic';

export default async function AdviceLayout({children}: {children: React.ReactNode}) {
  if (!(await hasSession())) redirect('/login');
  return <main className="adviceShell"><HouseholdNav active="advice"/><div className="content adviceContent">{children}</div></main>;
}
