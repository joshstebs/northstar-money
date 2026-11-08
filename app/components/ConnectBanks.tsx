'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {usePlaidLink} from 'react-plaid-link';

type Readiness={
  ok:boolean;
  checks:{
    providers:{plaid:boolean;flinks:boolean};
    plaidEnvironment:string;
  };
};

export function ConnectBanks(){
  const router = useRouter();
  const frame = useRef<HTMLIFrameElement>(null);
  const [flinksUrl, setFlinksUrl] = useState<string | null>(null);
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
            setMsg('Live banking is unavailable. You can still import a statement.');
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
    onSuccess:async(public_token, metadata)=>{
      setBusy(true);
      setMsg('Securing connection and starting initial sync…');
      try {
        const r = await fetch('/api/plaid/exchange', {method: 'POST', headers: {'content-type': 'application/json'},
          body: JSON.stringify({public_token, institution: metadata.institution?.name})});
        const data = await r.json();
        setMsg(r.ok && data.persisted && !data.error ? 'Plaid connected and refreshed.' : data.error ?? 'Plaid connection failed.');
        if (data.persisted) router.refresh();
      } catch {setMsg('Unable to reach NorthStar. Try again.');}
      finally {setBusy(false);}
    }
  });

  useEffect(() => {
    if (!flinksUrl) return;
    const origin = new URL(flinksUrl).origin;
    let handled = false;
    async function complete(event: MessageEvent) {
      if (handled || event.source !== frame.current?.contentWindow || event.origin !== origin ||
          event.data?.step !== 'REDIRECT' || typeof event.data.loginId !== 'string') return;
      handled = true;
      setFlinksUrl(null);
      setBusy(true);
      try {
        const result = await fetch('/api/flinks/complete', {method: 'POST', headers: {'content-type': 'application/json'},
          body: JSON.stringify({loginId: event.data.loginId, institution: event.data.institution})});
        const data = await result.json();
        setMsg(data.error ?? (data.persisted ? 'Flinks connected and refreshed.' : 'Flinks connection failed.'));
        if (data.persisted) router.refresh();
      } catch {setMsg('Unable to reach NorthStar. Try again.');}
      finally {setBusy(false);}
    }
    window.addEventListener('message', complete);
    return () => window.removeEventListener('message', complete);
  }, [flinksUrl, router]);

  async function flinks() {
    setBusy(true);
    try {
      const result = await fetch('/api/flinks/authorize', {method: 'POST'});
      const data = await result.json();
      if (data.connectUrl) {setFlinksUrl(data.connectUrl); setMsg('Complete your bank’s consent and sign-in in Flinks.');}
      else setMsg(data.error ?? 'Flinks is unavailable.');
    } catch {setMsg('Unable to open Flinks. Try again.');}
    finally {setBusy(false);}
  }

  async function sync() {
    setBusy(true);
    setMsg('Refreshing connected accounts…');
    try {
      const r = await fetch('/api/sync', {method: 'POST'});
      const data = await r.json();
      if (!r.ok) {setMsg(data.error ?? 'Sync failed.'); return;}
      const results: {ok: boolean}[] = data.results ?? [];
      const failed = results.filter(result => !result.ok);
      setMsg(!results.length ? 'No live accounts to refresh.' : failed.length ? `${failed.length} connection(s) need attention.` : 'Connected accounts refreshed.');
      router.refresh();
    } catch {setMsg('Unable to reach NorthStar. Try again.');}
    finally {setBusy(false);}
  }

  const plaidConfigured=readiness?.checks.providers.plaid??Boolean(token);
  const flinksConfigured=readiness?.checks.providers.flinks??false;
  const plaidEnv=readiness?.checks.plaidEnvironment;
  const hasProvider=plaidConfigured||flinksConfigured;

  return <div className="connect">
    <button onClick={()=>open()} disabled={busy||!ready||!token||!plaidConfigured}>
      Connect with Plaid{plaidEnv?` (${plaidEnv})`:''}
    </button>
    <button className="secondary" disabled={busy||!flinksConfigured} onClick={flinks}>Connect with Flinks</button>
    <button className="secondary" disabled={busy||!hasProvider} onClick={sync}>Refresh data</button>
    {flinksUrl && <div className="flinksConnect"><button className="secondary" onClick={() => setFlinksUrl(null)}>Close Flinks</button><iframe title="Flinks bank connection" ref={frame} src={flinksUrl} referrerPolicy="no-referrer"/></div>}
    {msg&&<small role="status" aria-live="polite">{msg}</small>}
  </div>;
}
