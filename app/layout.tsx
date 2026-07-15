import type {Metadata, Viewport} from 'next';
import PwaRegister from '@/components/PwaRegister';
import './styles/hm-design-tokens.css';
import './styles/hm-workbench-foundation.css';
import './globals.css';
import './account.css';
export const metadata:Metadata={
  title:'杭连协同平台',
  description:'计划、技术、生产高效闭环协同平台',
  applicationName:'杭连协同平台',
  manifest:'/manifest.webmanifest',
  appleWebApp:{capable:true,title:'杭连协同平台',statusBarStyle:'default'},
  icons:{icon:'/icon-192.png',apple:'/icon-192.png'},
  other:{
    'mobile-web-app-capable':'yes',
    'apple-mobile-web-app-capable':'yes',
    'apple-mobile-web-app-title':'杭连协同平台',
  },
};
export const viewport:Viewport={themeColor:'#ff6a00',width:'device-width',initialScale:1,maximumScale:1};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body><PwaRegister />{children}</body></html>}
