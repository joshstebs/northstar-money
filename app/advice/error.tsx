'use client';

export default function Error({reset}: {reset: () => void}) {
  return <section className="adviceCard" role="alert"><h1>Household advice is temporarily unavailable</h1><p>Try loading this page again in a moment.</p><button onClick={reset}>Try again</button></section>;
}
