import {hasSession} from '@/lib/security/request-auth';
import Link from 'next/link';
import {notFound, redirect} from 'next/navigation';
import {AdviceNav} from '@/app/components/HouseholdNav';
import {ActionForm, CurrencyInput} from '@/app/components/advice/Forms';
import {WorthChart} from '@/app/components/advice/Chart';
import {money} from '@/app/components/advice/format';
import {db} from '@/lib/db';
import {goalProgress} from '@/lib/finance/goals';
import {netWorth} from '@/lib/finance/net-worth';
import {accountKind} from '@/lib/finance/classify';
import {spendingInsights} from '@/lib/finance/spending-insights';

export default async function AdviceSection({params, searchParams}: {
  params: Promise<{section: string}>;
  searchParams: Promise<{month?: string}>;
}) {
  if (!(await hasSession())) redirect('/login');
  const {section} = await params;
  const {month} = await searchParams;
  if (section === 'insights') redirect('/insights');
  const sections = {
    'net-worth': ['Net worth', 'See the value of recorded assets and balances owed.'],
    budgets: ['Budgets', 'Plan spending together and see how each category is tracking.'],
    goals: ['Goals', 'Set targets and record what you’ve saved toward them.']
  } as const;
  if (!Object.hasOwn(sections, section)) notFound();
  const [title, description] = sections[section as keyof typeof sections];
  return <>
    <div className="adviceHeader"><p className="adviceKicker">NORTHSTAR ADVICE</p><h1>{title}</h1><p>{description}</p></div>
    <AdviceNav active={title}/>
    {section === 'net-worth' ? <NetWorth/> : section === 'budgets' ? <Budgets month={month}/> : <Goals/>}
  </>;
}

async function NetWorth() {
  const worth = await netWorth();
  const monthAgo = Date.now() - 30 * 86_400_000;
  const prior = worth.history.filter(point => Date.parse(point.date) <= monthAgo).at(-1);
  const latest = worth.history.at(-1);
  const balanceFields = [{name: 'name'}, {name: 'type'}, {name: 'amount', type: 'number'}] as const;
  return <div className="adviceGrid">
    <section className="adviceHero adviceWide"><div><p className="adviceKicker">RECORDED CAD BALANCES</p><h2>Current net worth</h2><strong>{worth.counted ? money(worth.net) : '—'}</strong>
      <p>{prior && latest ? `${money(latest.net - prior.net)} change from ${prior.date} to ${latest.date}` : 'Monthly change appears after enough balance snapshots are saved.'}</p></div>
      <dl><div><dt>Assets</dt><dd>{worth.counted ? money(worth.assets) : '—'}</dd></div><div><dt>Liabilities</dt><dd>{worth.counted ? money(worth.liabilities) : '—'}</dd></div></dl>
    </section>
    <section className="adviceCard"><h2>Recorded balances</h2><WorthChart points={worth.history}/>
      {worth.counted > 0 && <div className="adviceBars" aria-label="Assets and liabilities">
        <label>Assets <progress value={worth.assets} max={Math.max(1, worth.assets, worth.liabilities)}/></label>
        <label>Liabilities <progress value={worth.liabilities} max={Math.max(1, worth.assets, worth.liabilities)}/></label>
      </div>}
      {worth.excluded > 0 && <p>{worth.excluded} balances were excluded because the amount, currency, or account type could not be used.</p>}
    </section>
    <section className="adviceCard"><h2>Add a manual balance</h2><p>Use this for property, debts, and other balances you haven’t already connected.</p>
      <ActionForm button="Add balance" action={{kind: 'balance'}} fields={[...balanceFields]} reset>
        <label>Balance name<input name="name" maxLength={80} required/></label>
        <label>Balance type<select name="type"><option value="asset">Asset</option><option value="liability">Liability</option></select></label>
        <CurrencyInput label="Balance in CAD"/>
      </ActionForm>
    </section>
    <section className="adviceCard adviceWide"><h2>Household accounts</h2>
      {worth.accounts.length ? <ul className="adviceRows">{worth.accounts.map(account => <li key={account.id}>
        <div><b>{account.name}{account.mask ? ` · ••${account.mask}` : ''}</b><small>{account.connection.institutionName ?? account.connection.provider} · {accountKind(account)}{account.connection.status === 'attention' ? ' · Needs refresh' : ''}</small>
          {account.connection.provider === 'manual' && <details><summary>Edit balance</summary>
            <ActionForm button="Save balance" action={{kind: 'balance', id: account.id}} fields={[...balanceFields]}>
              <label>Balance name<input name="name" defaultValue={account.name} maxLength={80} required/></label>
              <label>Type<select name="type" defaultValue={account.type}><option value="asset">Asset</option><option value="liability">Liability</option></select></label>
              <CurrencyInput label="Balance in CAD" value={account.currentBalance ?? 0}/>
            </ActionForm>
            <ActionForm button="Remove manual balance" action={{kind: 'remove-balance', id: account.id}}/>
          </details>}
        </div><b>{account.currentBalance === null ? 'Balance unavailable' : new Intl.NumberFormat('en-CA', {style: 'currency', currency: account.currency.match(/^[A-Z]{3}$/) ? account.currency : 'CAD'}).format(account.currentBalance)}</b>
      </li>)}</ul> : <p>There are no accounts yet. <Link href="/#connections">Connect an account</Link> or add a manual balance.</p>}
    </section>
  </div>;
}

async function Budgets({month}: {month?: string}) {
  const report = await spendingInsights(month);
  const fields = [{name: 'category'}, {name: 'amount', type: 'number'}, {name: 'rollover', type: 'checkbox'}] as const;
  return <div className="adviceGrid">
    <section className="adviceCard adviceWide"><p className="adviceKicker">MONTHLY PLAN</p><h2>{report.monthLabel}</h2>
      <form action="/advice/budgets" className="adviceForm"><label>Reporting month<select name="month" defaultValue={report.month}>{report.monthOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><button>View month</button></form>
      <dl className="adviceTotals"><div><dt>Budgeted</dt><dd>{money(report.budgeted)}</dd></div><div><dt>Used</dt><dd>{money(report.usedFromBudgets)}</dd></div><div><dt>Remaining</dt><dd>{money(report.budgeted - report.usedFromBudgets)}</dd></div></dl>
      <ActionForm button="Copy missing budgets from previous month" action={{kind: 'copy-budgets', month: report.month}}/>
    </section>
    <section className="adviceCard"><h2>Category limits</h2>
      {report.budgetItems.length ? <ul className="adviceRows">{report.budgetItems.map(item => <li key={item.key}>
        <div><b>{item.name}</b><small>{item.status} · {money(item.used)} of {money(item.limit)} · {money(Math.abs(item.remaining))} {item.remaining < 0 ? 'over' : 'left'}</small>
        {item.carry > 0 && <small>Includes {money(item.carry)} rolled forward.</small>}
        {item.typical !== null && <small>Average in the previous three months with category activity {money(item.typical)}.</small>}
        <progress aria-label={item.name} data-status={item.status} max={100} value={Math.min(100, Math.max(0, item.percentage))}/>
        {item.entries.map(entry => <details key={entry.id}><summary>Edit {item.entries.length > 1 ? entry.category : 'limit'}</summary>
          <ActionForm button="Save limit" action={{kind: 'budget', id: entry.id, month: report.month}} fields={[...fields]}>
            <label>Category<input name="category" required defaultValue={entry.category} maxLength={80}/></label>
            <CurrencyInput label="Monthly limit in CAD" value={entry.limit}/>
            <label className="adviceCheck"><input name="rollover" type="checkbox" defaultChecked={entry.rollover}/> Carry unused funds between rollover months</label>
          </ActionForm>
          <ActionForm button="Remove limit" path={`/api/planning?kind=budget&id=${encodeURIComponent(entry.id)}`} method="DELETE"/>
        </details>)}</div>
      </li>)}</ul> : <p>No limits set for this month.</p>}
      {report.unbudgeted.length > 0 && <><h3>Unbudgeted spending</h3><ul className="adviceRows">{report.unbudgeted.slice(0, 8).map(item => <li key={item.key}><span>{item.name}</span><b>{money(item.amount)}</b></li>)}</ul></>}
    </section>
    <section className="adviceCard"><h2>Add a category limit</h2>
      <ActionForm button="Add budget" action={{kind: 'budget', month: report.month}} fields={[...fields]} reset>
        <label>Category<input name="category" list="budget-categories" maxLength={80} required/></label>
        <datalist id="budget-categories">{report.spendingByCategory.map(item => <option key={item.key} value={item.name}/>)}</datalist>
        <CurrencyInput label="Monthly limit in CAD"/>
        <label className="adviceCheck"><input name="rollover" type="checkbox"/> Carry unused funds between rollover months</label>
      </ActionForm>
      <h3>Budget alerts</h3><p>NorthStar flags budgets at the warning threshold and marks them over budget at 100%.</p>
      <ActionForm button="Save warning threshold" action={{kind: 'budget-settings'}} fields={[{name: 'warning', type: 'number'}]}>
        <label>Approaching-limit threshold (%)<input name="warning" type="number" min={1} max={99} step={1} defaultValue={report.warning} required/></label>
      </ActionForm>
    </section>
  </div>;
}

async function Goals() {
  const now = new Date();
  const ninetyDays = new Date(now.getTime() - 90 * 86_400_000);
  const goals = await db.goal.findMany({where: {userId: 'owner'}, orderBy: {targetDate: 'asc'}, include: {
    contributions: {where: {createdAt: {gte: ninetyDays}}, orderBy: {createdAt: 'desc'}}
  }});
  const fields = [{name: 'name'}, {name: 'targetAmount', type: 'number'}, {name: 'currentAmount', type: 'number'}, {name: 'targetDate'}] as const;
  return <div className="adviceGrid">
    <section className="adviceCard"><h2>Add a shared goal</h2>
      <ActionForm button="Create goal" path="/api/planning" action={{kind: 'goal'}} fields={[...fields]} reset>
        <label>Goal name<input name="name" maxLength={80} required/></label>
        <CurrencyInput name="targetAmount" label="Target in CAD" minimum={0.01}/>
        <CurrencyInput name="currentAmount" label="Already saved in CAD" optional/>
        <label>Target date<input name="targetDate" type="date"/></label>
      </ActionForm>
    </section>
    {!goals.length && <section className="adviceCard"><h2>Your goals will appear here</h2><p>Start with an emergency fund, a vacation, or another household priority.</p></section>}
    {goals.map(goal => {
      const saved = Number(goal.currentAmount), target = Number(goal.targetAmount);
      const recent = goal.contributions;
      const enoughHistory = recent.length >= 2 && recent[0].createdAt.getTime() - recent.at(-1)!.createdAt.getTime() >= 21 * 86_400_000;
      const pace = enoughHistory ? recent.reduce((sum, item) => sum + Number(item.amount), 0) / (90 / 30.4375) : null;
      const progress = goalProgress(saved, target, goal.targetDate, pace, now);
      return <section key={goal.id} className="adviceCard"><p className="adviceKicker">{progress.status}</p><h2>{goal.name}</h2>
        <strong className="adviceAmount">{money(saved)}</strong><p>of {money(target)} · {Math.round(progress.percent)}% funded</p>
        <progress aria-label={goal.name} max={100} value={progress.percent}/>
        <ul className="adviceRows">
          <li><span>Target date</span><b>{goal.targetDate?.toISOString().slice(0, 10) ?? 'Open'}</b></li>
          <li><span>Suggested monthly contribution</span><b>{progress.monthlyNeeded === null ? '—' : money(progress.monthlyNeeded)}</b></li>
          <li><span>Projected completion</span><b>{progress.projection?.toISOString().slice(0, 10) ?? '—'}</b></li>
        </ul>
        {enoughHistory && <p>Projection uses contributions logged over the past 90 days.</p>}
        {recent.length > 0 && <details><summary>Recent contributions</summary><ul className="adviceRows">{recent.slice(0, 6).map(item => <li key={item.id}><span>{item.createdAt.toISOString().slice(0, 10)}</span><b>{money(Number(item.amount))}</b></li>)}</ul></details>}
        <details><summary>Record a contribution</summary>
          <ActionForm button="Add contribution" action={{kind: 'contribution', id: goal.id}} fields={[{name: 'amount', type: 'number'}]} reset><CurrencyInput label="Contribution in CAD" minimum={0.01}/></ActionForm>
        </details>
        <details><summary>Edit goal</summary>
          <ActionForm button="Save goal" path="/api/planning" action={{kind: 'goal', id: goal.id}} fields={[...fields]}>
            <label>Goal name<input name="name" defaultValue={goal.name} required maxLength={80}/></label>
            <CurrencyInput name="targetAmount" label="Target in CAD" value={target} minimum={0.01}/>
            <CurrencyInput name="currentAmount" label="Already saved in CAD" value={saved}/>
            <label>Target date<input name="targetDate" type="date" defaultValue={goal.targetDate?.toISOString().slice(0, 10)}/></label>
          </ActionForm>
          <ActionForm button="Remove goal" path={`/api/planning?kind=goal&id=${encodeURIComponent(goal.id)}`} method="DELETE"/>
        </details>
      </section>;
    })}
  </div>;
}
