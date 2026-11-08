import Link from 'next/link';
import {ChartNoAxesCombined, House, LogOut, ShieldCheck, Sparkles, WalletCards} from 'lucide-react';

export function HouseholdNav({active}: {active: 'home' | 'advice' | 'insights'}) {
  return <aside className="householdNav">
    <div className="brand"><WalletCards aria-hidden="true"/> NorthStar Money</div>
    <nav aria-label="Household">
      <Link href="/" aria-current={active === 'home' ? 'page' : undefined}><House size={17} aria-hidden="true"/> Home</Link>
      <Link href="/advice" aria-current={active === 'advice' ? 'page' : undefined}><Sparkles size={17} aria-hidden="true"/> Advice</Link>
      <Link href="/insights" aria-current={active === 'insights' ? 'page' : undefined}><ChartNoAxesCombined size={17} aria-hidden="true"/> Insights</Link>
    </nav>
    <div className="safe"><ShieldCheck aria-hidden="true"/><div><b>Private household</b><small>Read-only bank connections</small></div></div>
    <form action="/api/auth/logout" method="post"><button className="logout"><LogOut size={16} aria-hidden="true"/> Sign out</button></form>
  </aside>;
}

const adviceLinks = [
  ['Overview', '/advice'], ['Insights', '/insights'], ['Net worth', '/advice/net-worth'],
  ['Budgets', '/advice/budgets'], ['Goals', '/advice/goals']
];

export function AdviceNav({active}: {active: string}) {
  return <nav className="adviceTabs" aria-label="Advice sections">
    {adviceLinks.map(([label, href]) => <Link key={href} href={href} aria-current={label === active ? 'page' : undefined}>{label}</Link>)}
  </nav>;
}
