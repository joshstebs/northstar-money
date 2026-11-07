import Link from 'next/link';
import {redirect} from 'next/navigation';
import {
  ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, CalendarRange, ChartNoAxesCombined,
  CircleAlert, CreditCard, Download, Info, Landmark, LogOut, ShieldCheck, WalletCards
} from 'lucide-react';
import {authConfigured} from '@/lib/security/auth';
import {hasSession} from '@/lib/security/request-auth';
import {spendingInsights} from '@/lib/finance/spending-insights';
import styles from './insights.module.css';

export const dynamic = 'force-dynamic';
const money = (amount: number) => new Intl.NumberFormat('en-CA', {style: 'currency', currency: 'CAD', maximumFractionDigits: 2}).format(amount);
const wholeMoney = (amount: number) => new Intl.NumberFormat('en-CA', {style: 'currency', currency: 'CAD', maximumFractionDigits: 0}).format(amount);

export default async function InsightsPage({searchParams}: {searchParams: Promise<{month?: string}>}) {
  if (!authConfigured() || !(await hasSession())) redirect('/login');
  const {month} = await searchParams;
  let report: Awaited<ReturnType<typeof spendingInsights>> | null = null;
  try {
    report = await spendingInsights(month);
  } catch (error) {
    console.error('Spending insights could not be loaded', error);
  }

  return <main className={styles.shell}>
    <aside>
      <div className="brand"><WalletCards/> Northstar Money</div>
      <nav aria-label="Main">
        <Link href="/">Overview</Link>
        <Link href="/insights" aria-current="page" className={styles.activeNav}>Insights & spending</Link>
        <Link href="/#transactions">Transactions</Link>
        <Link href="/#budgets">Budgets & goals</Link>
        <Link href="/#subscriptions">Recurring payments</Link>
        <Link href="/#advisor">AI advisor</Link>
      </nav>
      <div className="safe"><ShieldCheck/><div><b>Private household view</b><small>Read-only bank connections.</small></div></div>
      <form action="/api/auth/logout" method="post"><button className="logout"><LogOut size={15}/> Sign out</button></form>
    </aside>
    <section className={`content ${styles.content}`}>
      <div className={styles.breadcrumb}><Link href="/"><ArrowLeft size={15}/> Overview</Link><span>HOUSEHOLD FINANCES / INSIGHTS</span></div>
      <header className={styles.header}>
        <div>
          <div className={styles.kicker}><ChartNoAxesCombined size={16}/> FINANCIAL INSIGHTS</div>
          <h1>Understand where your money goes.</h1>
          <p>Track monthly income, spending, budgets and trends in one place. All figures come from your connected data.</p>
        </div>
        {report && <form action="/insights" method="get" className={styles.monthPicker}>
          <label htmlFor="month"><CalendarRange size={15}/> Reporting month</label>
          <div className={styles.monthRow}><select id="month" name="month" defaultValue={report.month}>
            {report.monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select><button type="submit">View <ArrowRight size={14}/></button></div>
        </form>}
      </header>
      {!report ? <div className="card warning">
        <h2>Financial database unavailable</h2>
        <p>The insights page needs a working PostgreSQL connection and applied Prisma migrations. Check the database and <code>/api/health</code> before connecting a bank.</p>
      </div> : <>
        {!report.hasAccounts && <div className={styles.emptyNotice}>
          <Landmark size={21}/><div><b>No accounts connected yet</b><p>Set up Plaid or Flinks in Vercel, then connect an account from the overview. No example transactions or invented balances are shown.</p></div>
          <Link href="/">Connect accounts <ArrowRight size={15}/></Link>
        </div>}
        {report.hasAccounts && !report.hasTransactions && <div className={styles.emptyNotice}>
          <Info size={21}/><div><b>No posted transactions for {report.monthLabel}</b><p>Try another month or refresh the bank connection. Pending transactions and excluded transfers are not counted as spending.</p></div><Link href="/">Refresh accounts <ArrowRight size={15}/></Link>
        </div>}
        <div className={styles.metricGrid}>
          <div className={styles.metric}><span><ArrowUpRight size={16}/> Income</span><strong>{wholeMoney(report.income)}</strong><small>Recorded cash-account inflows</small></div>
          <div className={styles.metric}><span><ArrowDownRight size={16}/> Spending</span><strong>{wholeMoney(report.spending)}</strong><small>{report.monthOverMonthSpending === null ? 'No prior-month comparison' : `${report.monthOverMonthSpending > 0 ? '+' : ''}${report.monthOverMonthSpending}% vs. previous month`}</small></div>
          <div className={styles.metric}><span><WalletCards size={16}/> Net cash flow</span><strong className={report.net < 0 ? styles.negative : styles.positive}>{wholeMoney(report.net)}</strong><small>Income minus recorded spending</small></div>
          <div className={styles.metric}><span><ChartNoAxesCombined size={16}/> Savings rate</span><strong>{report.savingsRate === null ? '—' : `${report.savingsRate}%`}</strong><small>{report.savingsRate === null ? 'Requires recorded income' : 'Net flow as a share of income'}</small></div>
        </div>

        <div className={styles.twoCol}>
          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.smallLabel}>LAST SIX MONTHS</span><h2>Income vs. spending</h2></div><span className={styles.legend}><i className={styles.incomeDot}/> Income <i className={styles.spendDot}/> Spending</span></div>
            <div className={styles.trendChart}>
              {report.monthlyTrend.map(m => {
                const max = Math.max(1, ...report.monthlyTrend.flatMap(x => [x.income, x.spending]));
                return <div className={styles.trendRow} key={m.month}>
                  <span>{m.label}</span>
                  <div className={styles.trendBars} aria-label={`${m.label}: income ${money(m.income)}; spending ${money(m.spending)}`}>
                    <div className={styles.incomeBar} style={{width: `${m.income / max * 100}%`}}/>
                    <div className={styles.spendBar} style={{width: `${m.spending / max * 100}%`}}/>
                  </div>
                  <small>{wholeMoney(m.income - m.spending)}</small>
                </div>;
              })}
            </div>
            <p className={styles.hint}>Figures show posted CAD transactions only. Each right-hand number is the month’s net cash flow.</p>
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.smallLabel}>{report.monthLabel.toUpperCase()}</span><h2>Where spending went</h2></div><CreditCard size={19}/></div>
            {report.spendingByCategory.length ? <div className={styles.categoryList}>
              {report.spendingByCategory.slice(0, 8).map((c, i) => <div key={c.key} className={styles.categoryRow}>
                <div className={styles.categoryTop}><span><i className={styles.categoryMark} style={{opacity: 1 - Math.min(i * 0.09, 0.65)}}/>{c.name}</span><b>{money(c.amount)} <small>{c.share}%</small></b></div>
                <div className={styles.progress}><div style={{width: `${Math.min(100, c.amount / Math.max(report.spending, 1) * 100)}%`}}/></div>
              </div>)}
            </div> : <p className={styles.noData}>No categorized spending in this month.</p>}
          </section>
        </div>

        <div className={styles.twoCol}>
          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.smallLabel}>MONTHLY PLAN</span><h2>Budget tracker</h2></div><Link href="/#budgets">Manage budgets <ArrowRight size={14}/></Link></div>
            {report.budgetItems.length ? <>
              <div className={styles.budgetSummary}><div><small>Budgeted</small><b>{wholeMoney(report.budgeted)}</b></div><div><small>Spent in budgeted categories</small><b>{wholeMoney(report.usedFromBudgets)}</b></div><div><small>Remaining</small><b className={report.budgeted - report.usedFromBudgets < 0 ? styles.negative : ''}>{wholeMoney(report.budgeted - report.usedFromBudgets)}</b></div></div>
              {report.budgetItems.map(b => <div key={b.id} className={styles.budgetRow}>
                <div className={styles.categoryTop}><span>{b.name}</span><b>{wholeMoney(b.used)} <small>/ {wholeMoney(b.limit)}</small></b></div>
                <div className={styles.progress}><div className={b.percentage >= 100 ? styles.overBudget : b.percentage >= 80 ? styles.nearBudget : ''} style={{width: `${Math.min(100, b.percentage)}%`}}/></div>
                <small className={b.remaining < 0 ? styles.negative : styles.hint}>{b.remaining < 0 ? `${money(-b.remaining)} over limit` : `${money(b.remaining)} left`} · {b.percentage}% used</small>
              </div>)}
            </> : <div className={styles.noData}><p>Set category budgets to see progress and overspending warnings.</p><Link href="/#budgets">Create your first budget <ArrowRight size={14}/></Link></div>}
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.smallLabel}>SPENDING PACE</span><h2>Daily spending</h2></div><CalendarRange size={19}/></div>
            <div className={styles.dailyChart} role="img" aria-label={`Daily spending during ${report.monthLabel}`}>
              {report.dailySpending.map(d => {
                const max = Math.max(1, ...report.dailySpending.map(x => x.amount));
                return <div key={d.day} className={styles.dailyColumn} title={`Day ${d.day}: ${money(d.amount)}`}>
                  <div style={{height: `${d.amount ? Math.max(3, d.amount / max * 100) : 0}%`}}/>
                </div>;
              })}
            </div>
            <div className={styles.dailyAxis}><span>1</span><span>Day {report.daysElapsed}</span><span>{report.dailySpending.length}</span></div>
            <div className={styles.paceFooter}><div><small>Recorded this month</small><b>{wholeMoney(report.spending)}</b></div><div><small>Simple pace estimate</small><b>{report.projectedSpending === null ? '—' : wholeMoney(report.projectedSpending)}</b></div></div>
            <p className={styles.hint}>The pace estimate extrapolates recorded spending; it is not a forecast and may change when transactions arrive late.</p>
          </section>
        </div>

        <div className={styles.twoCol}>
          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.smallLabel}>TOP PAYEES</span><h2>Where you spend most</h2></div></div>
            {report.merchants.length ? report.merchants.map((m, index) => <div key={m.name} className={styles.merchantRow}>
              <span className={styles.rank}>{String(index + 1).padStart(2, '0')}</span><div><b>{m.name}</b><small>{m.count} transaction{m.count === 1 ? '' : 's'}</small></div><strong>{money(m.amount)}</strong>
            </div>) : <p className={styles.noData}>Top merchants will appear once transactions are imported.</p>}
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.smallLabel}>ATTENTION</span><h2>Monthly observations</h2></div><CircleAlert size={19}/></div>
            {report.alerts.length ? report.alerts.map((a, i) => <div key={i} className={styles.observation}>
              <CircleAlert size={17}/><div><b>{a.title}</b><p>{a.detail}</p></div>
            </div>) : <div className={styles.noData}><p>There are no budget overruns or major spending alerts detected for this period.</p><p>Alerts become more useful after you add budgets and connect accounts.</p></div>}
            {report.largestPurchases.length > 0 && <div className={styles.largePurchases}><h3>Largest individual purchases</h3>
              {report.largestPurchases.slice(0, 4).map((p, i) => <div key={i} className={styles.purchaseRow}><div><b>{p.name}</b><small>{p.date} · {p.category}</small></div><strong>{money(p.amount)}</strong></div>)}
            </div>}
          </section>
        </div>
        <div className={styles.footnote}><Info size={17}/><p>{report.note} {report.excludedTransfers > 0 ? `${report.excludedTransfers} categorized transfer(s) were excluded this month.` : ''} Financial totals can be incomplete while institutions are disconnected or syncing.</p></div>
        <Link className={styles.backLink} href="/">Return to financial overview <ArrowRight size={15}/></Link>
      </>}
    </section>
  </main>;
}
