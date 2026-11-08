import {ActionForm} from './Forms';
import {money} from './format';

type Item = {id: string; name: string; amount: number; date: string; category: string};

export function TransactionDetails({items, empty = 'No transactions match this view.'}: {items: Item[]; empty?: string}) {
  if (!items.length) return <p>{empty}</p>;
  return <>
    <ul className="adviceRows">{items.slice(0, 50).map(item => <li key={item.id}>
      <div><b>{item.name}</b><small>{item.date} · {item.category}</small>
        <details><summary>Change category</summary>
          <ActionForm button="Save category" action={{kind: 'category', id: item.id}} fields={[{name: 'category', type: 'null'}]}>
            <label>Category<input name="category" defaultValue={item.category} maxLength={80}/></label>
            <small>Clear the field to use the bank category. Use Income, Refund or Internal transfer when applicable.</small>
          </ActionForm>
        </details>
      </div><b>{money(item.amount)}</b>
    </li>)}</ul>
    {items.length > 50 && <p>Showing the 50 most recent entries in this selection.</p>}
  </>;
}
