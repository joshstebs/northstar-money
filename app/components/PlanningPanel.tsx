'use client';
import {useState} from 'react';
export function PlanningPanel({accounts}:{accounts:Array<{id:string,name:string,apr:number|null,minimumPayment:number|null}>}){const[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);async function save(body: Record<string, unknown>) {
  setBusy(true); setMsg('');
  try {
    const r = await fetch('/api/planning', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
    const d = await r.json().catch(() => ({}));
    setMsg(r.ok ? 'Saved. Refreshing…' : d.error ?? 'Unable to save');
    if (r.ok) window.location.reload();
  } catch {setMsg('Unable to connect. Please try again.');}
  finally {setBusy(false);}
}return <div className="plannerGrid"><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);save({kind:'budget',category:f.get('category'),amount:f.get('amount'),month:f.get('month')})}}><h3>Add / update monthly budget</h3><input name="category" placeholder="Category e.g. FOOD_AND_DRINK" required/><input name="amount" type="number" min="0" step="0.01" placeholder="Monthly CAD limit" required/><input name="month" type="month" defaultValue={new Date().toISOString().slice(0,7)}/><button disabled={busy}>Save budget</button></form><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);save({kind:'goal',name:f.get('name'),targetAmount:f.get('targetAmount'),currentAmount:f.get('currentAmount'),targetDate:f.get('targetDate')})}}><h3>Add savings goal</h3><input name="name" placeholder="Goal name" required/><input name="targetAmount" type="number" min="0" step="0.01" placeholder="Target CAD" required/><input name="currentAmount" type="number" min="0" step="0.01" placeholder="Already saved"/><input name="targetDate" type="date"/><button disabled={busy}>Save goal</button></form>{accounts.length>0&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);save({kind:'debt-terms',accountId:f.get('accountId'),apr:f.get('apr'),minimumPayment:f.get('minimumPayment')})}}><h3>Debt optimizer inputs</h3><select name="accountId" required>{accounts.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select><input name="apr" type="number" min="0" max="100" step="0.01" placeholder="APR %"/><input name="minimumPayment" type="number" min="0" step="0.01" placeholder="Minimum payment CAD"/><button disabled={busy}>Save debt terms</button></form>}{msg&&<p role="status">{msg}</p>}</div>}

