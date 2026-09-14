'use client';

import {useCallback,useEffect,useState} from 'react';
import {usePlaidLink} from 'react-plaid-link';

type Readiness={
  ok:boolean;
  checks:{
    providers:{plaid:boolean;flinks:boolean};
    plaidEnvironment:string;
  };
};

export function ConnectBanks(){
  const [token,setToken]=useState<string|null>(null);
  const [msg,setMsg]=useState('Checking bank connection setup…');
  const [busy,setBusy]=useState(false);
  const [readiness,setReadiness]=useState<Readiness|null>(null);

  const loadPlaid=useCallback(async()=>{
    try{
      const r=await fetch('/api/plaid/link-token',{method:'POST'});
      const d=await r.json().catch(()=>({}));
      if(r.ok&&d.link_token){setToken(d.link_token);return true}
      setToken(null);
      return false;
    }catch{
      setToken(null);
      return false;
    }
  },[]);

  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        const r=await fetch('/api/system/readiness',{cache:'no-store'});
        const d=await r.json().catch(()=>null) as Readiness|null;
        if(!active)return;
        if(r.ok&&d){
          setReadiness(d);
          if(d.checks.providers.plaid){
            const loaded=await loadPlaid();
            if(!active)return;
            setMsg(loaded?`Plaid ${d.checks.plaidEnvironment} is ready for a connection.`:'Plaid is configured but Link could not be initialized.');
          }else if(d.checks.providers.flinks){
            setMsg('Flinks is configured and ready for a connection.');
          }else{
            setMsg('No banking provider is configured yet. Add Plaid Sandbox or Flinks credentials in Vercel.');
          }
          return;
        }
      }catch{}
      if(!active)return;
      const loaded=await loadPlaid();
      if(active)setMsg(loaded?'Plaid is ready for a connection.':'Unable to verify banking-provider setup.');
    })();
    return()=>{active=false};
  },[loadPlaid]);

  const {open,ready}=usePlaidLink({
    token,
    onSuccess:async(public_token)=>{
      setBusy(true);
      setMsg('Securing connection and starting initial sync…');
      const r=await fetch('/api/plaid/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({public_token})});
      const d=await r.json().catch(()=>({}));
      setBusy(false);
      if(r.ok&&d.persisted){
        setMsg(`Plaid connected securely. Initial sync: ${d.initialSync?.accounts??0} accounts, ${d.initialSync?.added??0} new transactions.`);
        window.location.reload();
      }else setMsg(d.error??'Plaid connection failed.');
    }
  });

  async function flinks(){
    setBusy(true);
    setMsg('Opening Flinks secure connection…');
    const r=await fetch('/api/flinks/authorize',{method:'POST'});
    const d=await r.json().catch(()=>({}));
    if(d.connectUrl)window.location.href=d.connectUrl;
    else{
      setBusy(false);
      setMsg(d.error??'Flinks configuration required.');
    }
  }

  async function sync(){
    setBusy(true);
    setMsg('Refreshing connected accounts…');
    const r=await fetch('/api/sync',{method:'POST'});
    const d=await r.json().catch(()=>({}));
    setBusy(false);
    if(!r.ok)return setMsg(d.error??'Sync failed');
    const failed=(d.results??[]).filter((x:any)=>!x.ok);
    setMsg(failed.length?`Sync completed with ${failed.length} connection requiring attention.`:'All connected accounts refreshed.');
    window.location.reload();
  }

  const plaidConfigured=readiness?.checks.providers.plaid??Boolean(token);
  const flinksConfigured=readiness?.checks.providers.flinks??true;
  const plaidEnv=readiness?.checks.plaidEnvironment;
  const hasProvider=plaidConfigured||flinksConfigured;

  return <div className="connect">
    <button onClick={()=>open()} disabled={busy||!ready||!token||!plaidConfigured}>
      Connect with Plaid{plaidEnv?` (${plaidEnv})`:''}
    </button>
    <button className="secondary" disabled={busy||!flinksConfigured} onClick={flinks}>Connect with Flinks</button>
    <button className="secondary" disabled={busy||!hasProvider} onClick={sync}>Refresh data</button>
    {msg&&<small role="status" aria-live="polite">{msg}</small>}
  </div>;
}
