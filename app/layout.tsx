import './globals.css';
export const metadata={
  metadataBase:new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://northstar.harbourandmain.com'),
  alternates:{canonical:'./'},
  title:'Northstar Money',
  description:'Private AI financial command centre'
};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
