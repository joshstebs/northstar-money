import {hasSession} from '@/lib/security/request-auth';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {ArrowUpRight, CalendarClock, CircleAlert, Wallet} from 'lucide-react';
import {AdviceNav} from '@/app/components/HouseholdNav';
import {FinancialBriefCard} from '@/app/components/FinancialBriefCard';
import {money} from '@/app/components/advice/format';
import {availableBrief, bankDataStale} from '@/lib/finance/advice';
import {financialSnapshot} from '@/lib/finance/analytics';
import {spendingInsights} from '@/lib/finance/spending-insights';
import {householdDay} from '@/lib/finance/planning';
import {netWorth} from '@/lib/finance/net-worth';

export default async function AdvicePage() {
  if (!(await hasSession())) redirect('/login');
  const [snapshot, report, worth] = await Promise.all([financialSnapshot(), spendingInsights(), netWorth()]);
  const latest = snapshot.storedInsights.find(item => item.type === 'weekly' && Date.now() - Date.parse(item.createdAt) < 8 * 86_400_000);
  const attention = report.budgetItems.filter(item => item.status !== 'On track').length;
  const stale = bankDataStale(snapshot.accounts);
  const fallback = availableBrief({hasData: report.hasTransactions, accountCount: snapshot.accounts.length, stale, net: report.net, budgetAttention: attention});
  fallback.dataQualityCaveats.push(...report.qualityNotes);
  const upcoming = snapshot.recurring.filter(item => item.next >= householdDay()).slice(0, 4);

  return <>
    <div className="adviceHeader"><p className="adviceKicker">HOUSEHOLD FINANCES</p><h1>Advice</h1><p>See what came in, where it went, and what to plan for next.</p></div>
    <AdviceNav active="Overview"/>
    <section className="adviceHero">
      <div><p className="adviceKicker">{report.monthLabel}</p><h2>Household cash flow</h2><strong>{report.hasTransactions ? money(report.net) : '—'}</strong>
        <p>{!report.hasTransactions ? 'Connect a bank or import a statement to see this month’s activity.' :
          report.net >= 0 ? 'Recorded income covers recorded spending this month.' : 'Recorded spending is ahead of recorded income this month.'}</p>
      </div>
      <dl><div><dt>Income</dt><dd>{report.hasTransactions ? money(report.income) : '—'}</dd></div><div><dt>Net spending</dt><dd>{report.hasTransactions ? money(report.spending) : '—'}</dd></div></dl>
      <Link href="/insights">Explore spending <ArrowUpRight size={16}/></Link>
    </section>
    <div className="adviceGrid">
      <section className="adviceCard adviceWide"><p className="adviceKicker">WEEKLY REVIEW</p><h2>Your weekly financial brief</h2>
        <FinancialBriefCard stored={latest?.body} fallback={fallback} hasData={report.hasTransactions}/>
      </section>
      <section className="adviceCard"><div className="adviceCardHead"><Wallet size={20}/><Link href="/advice/net-worth">View net worth <ArrowUpRight size={15}/></Link></div><h2>Current net worth</h2>
        <strong className="adviceAmount">{worth.counted ? money(worth.net) : '—'}</strong>
        <p>{worth.counted ? `${money(worth.assets)} in assets · ${money(worth.liabilities)} owed` : 'Add a manual balance or sync an account.'}</p>
      </section>
      <section className="adviceCard"><div className="adviceCardHead"><CircleAlert size={20}/><Link href="/advice/budgets">Manage budgets <ArrowUpRight size={15}/></Link></div><h2>Budget health</h2>
        <strong className="adviceAmount">{report.budgetItems.length ? `${report.budgetItems.length - attention} of ${report.budgetItems.length} on track` : 'No limits set'}</strong>
        <p>{report.budgetItems.length ? `${money(report.budgeted - report.usedFromBudgets)} remaining across budgeted categories` : 'Set monthly limits for the categories you want to watch.'}</p>
      </section>
      <section className="adviceCard"><div className="adviceCardHead"><CalendarClock size={20}/><Link href="/#subscriptions">View recurring payments <ArrowUpRight size={15}/></Link></div><h2>Upcoming recurring bills</h2>
        {upcoming.length ? <ul className="adviceRows">{upcoming.map(item => <li key={item.merchant}><span>{item.merchant}<small>Estimated {item.next}</small></span><b>{money(item.average)}</b></li>)}</ul> :
          <p>Expected bills appear after NorthStar finds enough consistent payments.</p>}
      </section>
      <section className="adviceCard"><div className="adviceCardHead"><Link href="/insights#merchants">See all merchants <ArrowUpRight size={15}/></Link></div><h2>Top merchants</h2>
        {report.merchants.length ? <ol className="adviceRows">{report.merchants.slice(0, 3).map(item => <li key={item.name}><span>{item.name}<small>{item.count} purchases</small></span><b>{money(item.amount)}</b></li>)}</ol> :
          <p>Merchant rankings appear once spending is recorded.</p>}
      </section>
      <section className="adviceCard"><div className="adviceCardHead"><Link href="/advice/goals">Manage goals <ArrowUpRight size={15}/></Link></div><h2>Shared savings goals</h2>
        {snapshot.goals.length ? <ul className="adviceRows">{snapshot.goals.slice(0, 4).map(goal => <li key={goal.id}><span>{goal.name}<progress aria-label={goal.name} max={100} value={goal.percent}/></span><b>{goal.percent}%</b></li>)}</ul> : <p>Add a shared goal to track what you’ve saved toward it.</p>}
      </section>
      <section className="adviceCard"><h2>What to review</h2>
        {report.alerts.length ? <ul className="adviceRows">{report.alerts.map(alert => <li key={alert.title}><span><Link href={alert.href}>{alert.title}</Link><small>{alert.detail} Based on posted activity.</small></span></li>)}</ul> :
          <p>{report.hasTransactions ? 'No spending or budget flags from recorded activity this month.' : 'Observations appear when there is enough recorded activity.'}</p>}
      </section>
    </div>
  </>;
}
