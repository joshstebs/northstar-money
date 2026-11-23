import Link from 'next/link';
import {redirect} from 'next/navigation';
import {
  ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, CalendarRange, ChartNoAxesCombined,
  CircleAlert, CreditCard, Info, Landmark, Repeat2, Sparkles, WalletCards
} from 'lucide-react';
import {authConfigured} from '@/lib/security/auth';
import {hasSession} from '@/lib/security/request-auth';
import {spendingInsights} from '@/lib/finance/spending-insights';
import styles from './insights.module.css';
import {AdviceNav, HouseholdNav} from '@/app/components/HouseholdNav';
import {TransactionDetails} from '@/app/components/advice/TransactionDetails';
import {ActionForm} from '@/app/components/advice/Forms';

const categoryColors = ['#66dcb1', '#51b8e0', '#d4ae68', '#afabed', '#e4958e', '#78c587', '#84a6ef', '#db92c2'];

export const dynamic = 'force-dynamic';
const money = (amount: number) => new Intl.NumberFormat('en-CA', {style: 'currency', currency: 'CAD', maximumFractionDigits: 2}).format(amount);
const wholeMoney = (amount: number) => new Intl.NumberFormat('en-CA', {style: 'currency', currency: 'CAD', maximumFractionDigits: 0}).format(amount);

export default async function InsightsPage({searchParams}: {searchParams: Promise<{month?: string; period?: string; category?: string; merchant?: string}>}) {
  if (!authConfigured() || !(await hasSession())) redirect('/login');
  const {month, period, category, merchant} = await searchParams;
  const months = period === "12" ? 12 : 6;
  let report: Awaited<ReturnType<typeof spendingInsights>> | null = null;
  try {
    report = await spendingInsights(month, months);
  } catch (error) {
    console.error('Spending insights could not be loaded', error);
  }

  return <main className={styles.shell}>
    <HouseholdNav active="insights"/>
    <section className={`content ${styles.content}`}>
      <div className={styles.breadcrumb}><Link href="/advice"><ArrowLeft size={15}/> Advice</Link><span>HOUSEHOLD FINANCES / INSIGHTS</span></div>
      <header className={styles.header}>
        <div>
          <div className={styles.kicker}><ChartNoAxesCombined size={16}/> FINANCIAL INSIGHTS</div>
          <h1>Understand where your money goes.</h1>
          <p>Track monthly income, spending, budgets and trends in one place. Figures come from posted bank and statement activity.</p>
        </div>
        {report && <form action="/insights" method="get" className={styles.monthPicker}>
          <label htmlFor="month"><CalendarRange size={15}/> Reporting month</label>
          <div className={styles.monthRow}><select id="month" name="month" defaultValue={report.month}>
            {report.monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select><button type="submit">View <ArrowRight size={14}/></button></div>
          <label htmlFor="period">Trend window</label>
          <select id="period" name="period" defaultValue={months}><option value="6">Six months</option><option value="12">Twelve months</option></select>
        </form>}
      </header>
      <AdviceNav active="Insights"/>
      {!report ? <div className="card warning">
        <h2>Financial database unavailable</h2>
        <p>The insights page needs a working PostgreSQL connection and applied Prisma migrations. Check the database and <code>/api/health</code> before connecting a bank.</p>
      </div> : <>
        {!report.hasAccounts && <div className={styles.emptyNotice}>
          <Landmark size={21}/><div><b>No accounts connected yet</b><p>Connect a bank account or import a credit-card statement to start building your household report.</p></div>
          <Link href="/#connections">Connect accounts <ArrowRight size={15}/></Link>
        </div>}
        {report.hasAccounts && !report.hasTransactions && <div className={styles.emptyNotice}>
          <Info size={21}/><div><b>No posted transactions for {report.monthLabel}</b><p>Try another month or refresh the bank connection. Pending transactions and excluded transfers are not counted as spending.</p></div><Link href="/">Refresh accounts <ArrowRight size={15}/></Link>
        </div>}
        <div className={styles.metricGrid}>
          <div className={styles.metric}><span><ArrowUpRight size={16}/> Income</span><strong>{report.hasTransactions ? wholeMoney(report.income) : "—"}</strong><small>{report.monthOverMonthIncome === null ? 'Classified income' : `${report.monthOverMonthIncome > 0 ? '+' : ''}${report.monthOverMonthIncome}% vs. previous ${report.isCurrentMonth ? 'full ' : ''}month`}</small></div>
          <div className={styles.metric}><span><ArrowDownRight size={16}/> Spending</span><strong>{report.hasTransactions ? wholeMoney(report.spending) : "—"}</strong><small>{report.monthOverMonthSpending === null ? 'No prior-month comparison' : `${report.monthOverMonthSpending > 0 ? '+' : ''}${report.monthOverMonthSpending}% vs. previous ${report.isCurrentMonth ? 'full ' : ''}month`}</small></div>
          <div className={styles.metric}><span><WalletCards size={16}/> Net cash flow</span><strong className={report.net < 0 ? styles.negative : styles.positive}>{report.hasTransactions ? wholeMoney(report.net) : "—"}</strong><small>Income minus recorded spending</small></div>
          <div className={styles.metric}><span><ChartNoAxesCombined size={16}/> Savings rate</span><strong>{report.savingsRate === null ? '—' : `${report.savingsRate}%`}</strong><small>{report.savingsRate === null ? 'Requires recorded income' : 'Net flow as a share of income'}</small></div>
        </div>

        <div className={styles.twoCol}>
          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.smallLabel}>LAST {months} MONTHS</span><h2>Income vs. spending</h2></div><span className={styles.legend}><i className={styles.incomeDot}/> Income <i className={styles.spendDot}/> Spending</span></div>
            <div className="incomeChart" style={{gridTemplateColumns: `repeat(${months}, minmax(0, 1fr))`}}>
              {report.monthlyTrend.map(m => {
                const max = Math.max(1, ...report.monthlyTrend.flatMap(x => [x.income, Math.abs(x.spending)]));
                return <div className="incomeMonth" key={m.month} title={m.count ? `${m.month}: income ${money(m.income)}, spending ${money(m.spending)}` : `${m.month}: no recorded activity`}>
                  <div className="incomePair" aria-label={m.count ? `${m.month}: income ${money(m.income)} and net spending ${money(m.spending)}` : `${m.month}: no recorded activity`}>
                    <i style={{height: `${m.income / max * 100}%`}}/><i data-negative={m.spending < 0} style={{height: `${Math.abs(m.spending) / max * 100}%`}}/>
                  </div>
                  <small>{m.label.slice(0, months === 12 ? 1 : 3)}</small>
                </div>;
              })}
            </div>
            <details className="financialDetail"><summary>View monthly figures</summary><ul className="adviceRows">{report.monthlyTrend.map(m => <li key={m.month}><span>{m.month}</span><b>{m.count ? `${money(m.income)} income · ${money(m.spending)} spending` : 'No recorded activity'}</b></li>)}</ul></details>
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.smallLabel}>{report.monthLabel.toUpperCase()}</span><h2>Where spending went</h2></div><CreditCard size={19}/></div>
            {report.spendingByCategory.length ? <>
              {report.spendingByCategory.some(c => c.chartShare > 0) && <div className="categoryDonut" role="img" aria-label="Share of positive net spending by category" style={{
                background: `conic-gradient(${report.spendingByCategory.filter(c => c.chartShare > 0).map((c, i, list) => {
                  const start = list.slice(0, i).reduce((sum, item) => sum + item.chartShare, 0);
                  return `${categoryColors[i % categoryColors.length]} ${start}% ${start + c.chartShare}%`;
                }).join(',')})`
              }}><span>{wholeMoney(report.spending)}</span></div>}
              <div className={styles.categoryList}>
                {report.spendingByCategory.map((c, i) => <div key={c.key} className={styles.categoryRow}>
                  <div className={styles.categoryTop}><Link href={`/insights?month=${report.month}&period=${months}&category=${encodeURIComponent(c.key)}#breakdown`}><i className={styles.categoryMark} style={{background: categoryColors[i % categoryColors.length]}}/>{c.name}</Link><b>{money(c.amount)} <small>{c.share}%</small></b></div>
                </div>)}
              </div></> : <p className={styles.noData}>No categorized spending in this month.</p>}
          </section>
        </div>

        <div className={styles.twoCol}>
          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.smallLabel}>MONTHLY PLAN</span><h2>Budget tracker</h2></div><Link href={`/advice/budgets?month=${report.month}`}>Manage budgets <ArrowRight size={14}/></Link></div>
            {report.budgetItems.length ? <>
              <div className={styles.budgetSummary}><div><small>Budgeted</small><b>{wholeMoney(report.budgeted)}</b></div><div><small>Spent in budgeted categories</small><b>{wholeMoney(report.usedFromBudgets)}</b></div><div><small>Remaining</small><b className={report.budgeted - report.usedFromBudgets < 0 ? styles.negative : ''}>{wholeMoney(report.budgeted - report.usedFromBudgets)}</b></div></div>
              {report.budgetItems.map(b => <div key={b.id} className={styles.budgetRow}>
                <div className={styles.categoryTop}><span>{b.name}</span><b>{wholeMoney(b.used)} <small>/ {wholeMoney(b.limit)}</small></b></div>
                <div className={styles.progress}><div className={b.status === 'Over budget' ? styles.overBudget : b.status === 'Approaching limit' ? styles.nearBudget : ''} style={{width: `${Math.max(0, Math.min(100, b.percentage))}%`}}/></div>
                <small className={b.remaining < 0 ? styles.negative : styles.hint}>{b.remaining < 0 ? `${money(-b.remaining)} over limit` : `${money(b.remaining)} left`} · {b.percentage}% used</small>
              </div>)}
            </> : <div className={styles.noData}><p>Set category budgets to see progress and overspending warnings.</p><Link href={`/advice/budgets?month=${report.month}`}>Create your first budget <ArrowRight size={14}/></Link></div>}
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.smallLabel}>SPENDING PACE</span><h2>Daily spending</h2></div><CalendarRange size={19}/></div>
            <div className={styles.dailyChart} role="img" aria-label={`Daily spending during ${report.monthLabel}`}>
              {report.dailySpending.map(d => {
                const max = Math.max(1, ...report.dailySpending.map(x => x.amount));
                return <div key={d.day} className={styles.dailyColumn} title={`Day ${d.day}: ${money(d.amount)}`}>
                  <div style={{height: `${d.amount ? d.amount > 0 ? Math.max(3, d.amount / max * 100) : 0 : 0}%`}}/>
                </div>;
              })}
            </div>
            <div className={styles.dailyAxis}><span>1</span><span>Day {report.daysElapsed}</span><span>{report.dailySpending.length}</span></div>
            <div className={styles.paceFooter}><div><small>Average daily net spending</small><b>{report.hasTransactions ? money(report.averageDaily) : "—"}</b></div><div><small>Simple pace estimate</small><b>{report.projectedSpending === null ? '—' : wholeMoney(report.projectedSpending)}</b></div></div>
            <p className={styles.hint}>The pace estimate extrapolates recorded spending; it is not a forecast and may change when transactions arrive late.</p>
          </section>
        </div>

        <div className={styles.twoCol}>
          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.smallLabel}>RECURRING</span><h2>Bills &amp; subscriptions</h2></div><Repeat2 size={19}/></div>
            {report.recurring.length ? report.recurring.map(item => <div key={item.merchant} className={styles.merchantRow}>
              <div><b>{item.merchant}</b><small>{item.cadence} · next around {item.next} · {item.occurrences} recorded charges</small></div><strong>{money(item.average)}</strong>
            </div>) : <div className={styles.noData}><p>Recurring payments appear after at least three consistent charges. Dates are estimated from your recorded activity.</p></div>}
            {report.recurring.length > 0 && <p className={styles.hint}>Estimated from posted transactions. Merchant dates and amounts can change.</p>}
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.smallLabel}>OPPORTUNITIES</span><h2>Potential savings</h2></div><Sparkles size={19}/></div>
            {report.savingsOpportunities.length ? <>
              <p><b>{wholeMoney(report.potentialSavingsTotal)}</b> above recent category baselines this month.</p>
              {report.savingsOpportunities.map(item => <div key={item.key} className={styles.purchaseRow}>
                <div><b>{item.name}</b><small>Now {money(item.current)} · typical {money(item.baseline)}</small></div><strong className={styles.positive}>{money(item.possibleSavings)}</strong>
              </div>)}
              <p className={styles.hint}>Data-derived estimate, not a guarantee. It compares this month with up to three prior months that had activity in the category.</p>
            </> : <div className={styles.noData}><p>No category is currently running far above its recent baseline. Opportunities need at least two prior months of activity.</p></div>}
          </section>
        </div>
        <div className={styles.twoCol}>
          <section className={styles.panel} id="merchants">
            <div className={styles.panelHeading}><div><span className={styles.smallLabel}>TOP PAYEES</span><h2>Where you spend most</h2></div></div>
            {report.merchants.length ? report.merchants.map((m, index) => <div key={m.name} className={styles.merchantRow}>
              <span className={styles.rank}>{String(index + 1).padStart(2, '0')}</span><div><Link href={`/insights?month=${report.month}&period=${months}&merchant=${encodeURIComponent(m.name)}#breakdown`}>{m.name}</Link><small>{m.count} purchase{m.count === 1 ? '' : 's'}{m.previous !== null ? ` · ${money(m.previous)} last month` : ''}</small></div><strong>{money(m.amount)}</strong>
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
        <div className={styles.twoCol}>
          <section className={styles.panel}><h2>Payroll and recurring income</h2>
            {report.payroll.length ? report.payroll.map(source => <details className="financialDetail" key={source.key}>
              <summary>{source.name} · {source.confirmed === true ? 'Confirmed payroll' : source.confirmed === false ? 'Rejected as payroll' : source.identified ? 'Likely payroll' : 'Possible recurring income'}</summary>
              <p>{source.cadence ?? 'Frequency needs more history'}{source.monthly !== null && source.confirmed !== false ? ` · Estimated ${money(source.monthly)} per month` : ''}</p>
              <ul className="adviceRows">{source.deposits.map((deposit, index) => <li key={index}><span>{deposit.date}</span><b>{money(deposit.amount)}</b></li>)}</ul>
              {source.confirmed !== true && <ActionForm button="Confirm as payroll" action={{kind: 'payroll', id: source.transactionId, confirmed: true}}/>}
              {source.confirmed !== false && <ActionForm button="Reject as payroll" action={{kind: 'payroll', id: source.transactionId, confirmed: false}}/>}
            </details>) : <p>Payroll clues appear when NorthStar sees a payroll description or several consistent income deposits.</p>}
          </section>
          <section className={styles.panel} id="breakdown"><h2>{merchant || (category && report.spendingByCategory.find(item => item.key === category)?.name) || 'Review unclassified activity'}</h2>
            {merchant && <ul className="adviceRows">{report.merchants.find(item => item.name === merchant)?.trend.map(point => <li key={point.month}><span>{point.month}</span><b>{point.available ? money(point.amount) : '—'}</b></li>)}</ul>}
            <TransactionDetails items={merchant ? report.merchants.find(item => item.name === merchant)?.purchases ?? [] : category ? report.expenses.filter(item => item.category === category) : report.review}
              empty={category || merchant ? 'No matching activity for this month.' : 'Credits that need review will appear here.'}/>
            {(category || merchant) && <Link href={`/insights?month=${report.month}&period=${months}#breakdown`}>Back to unclassified activity</Link>}
          </section>
        </div>
        <div className={styles.footnote}><Info size={17}/><p>{report.note} {report.qualityNotes.join(' ')} {report.excludedTransfers > 0 ? `${report.excludedTransfers} categorized transfer(s) were excluded this month.` : ''} Financial totals can be incomplete while institutions are disconnected or syncing.</p></div>
        <Link className={styles.backLink} href="/">Return to financial overview <ArrowRight size={15}/></Link>
      </>}
    </section>
  </main>;
}
