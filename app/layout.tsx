import type {Metadata, Viewport} from 'next';
import PwaRegister from '@/components/PwaRegister';
import './globals.css';
import './account.css';
export const metadata:Metadata={
  title:'工单资料库',
  description:'鸿蒙平板工单资料管理系统',
  manifest:'/manifest.webmanifest',
  appleWebApp:{capable:true,title:'工单资料库',statusBarStyle:'default'},
  icons:{icon:'/icon-192.svg',apple:'/icon-192.svg'},
};
export const viewport:Viewport={themeColor:'#FF6A00',width:'device-width',initialScale:1,maximumScale:1};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body><PwaRegister />{children}</body></html>}
