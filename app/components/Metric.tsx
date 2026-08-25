export function Metric({label,value,sub}:{label:string,value:string,sub?:string}){return <div className="card metric"><span>{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</div>}
