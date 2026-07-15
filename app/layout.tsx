import type {Metadata, Viewport} from 'next';
import PwaRegister from '@/components/PwaRegister';
import './styles/hm-design-tokens.css';
import './styles/hm-workbench-foundation.css';
import './globals.css';
import './account.css';
export const metadata:Metadata={
  title:'工单资料库',
  description:'鸿蒙平板工单资料管理系统',
  applicationName:'工单资料库',
  manifest:'/manifest.webmanifest',
  appleWebApp:{capable:true,title:'工单资料库',statusBarStyle:'default'},
  icons:{icon:'/icon-192.png',apple:'/icon-192.png'},
  other:{
    'mobile-web-app-capable':'yes',
    'apple-mobile-web-app-capable':'yes',
    'apple-mobile-web-app-title':'工单资料库',
  },
};
export const viewport:Viewport={themeColor:'#ff6a00',width:'device-width',initialScale:1,maximumScale:1};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body><PwaRegister />{children}</body></html>}
