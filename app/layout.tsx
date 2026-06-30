import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'工单资料库',description:'鸿蒙平板工单资料管理系统'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
