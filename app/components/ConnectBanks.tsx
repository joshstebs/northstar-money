'use client';
import {useEffect,useState} from 'react';
import {usePlaidLink} from 'react-plaid-link';
export function ConnectBanks(){const[token,setToken]=useState<string|null>(null);const[msg,setMsg]=useState('');
useEffect(()=>{fetch('/api/plaid/link-token',{method:'POST'}).then(r=>r.json()).then(d=>setToken(d.link_token??null)).catch(()=>{})},[]);
const {open,ready}=usePlaidLink({token,onSuccess:async(public_token)=>{await fetch('/api/plaid/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({public_token})});setMsg('Plaid account connected.');}});
async function flinks(){const r=await fetch('/api/flinks/authorize',{method:'POST'});const d=await r.json(); if(d.connectUrl) window.location.href=d.connectUrl; else setMsg(d.error??'Flinks configuration required.');}
return <div className="connect"><button onClick={()=>open()} disabled={!ready||!token}>Connect with Plaid</button><button className="secondary" onClick={flinks}>Connect with Flinks</button>{msg&&<small>{msg}</small>}</div>}
