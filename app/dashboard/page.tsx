import {redirect} from 'next/navigation';
import DashboardShell from '@/components/DashboardShell';
import {currentUser} from '@/lib/auth';
import {prisma} from '@/lib/prisma';
export default async function Dashboard(){const user=await currentUser(); if(!user)redirect('/login'); const [orders,categories]=await Promise.all([prisma.workOrder.findMany({orderBy:[{createdAt:'desc'},{code:'asc'}]}),prisma.resourceCategory.findMany({orderBy:{sortOrder:'asc'}})]); return <DashboardShell user={user} initialWorkOrders={orders.map(o=>({...o,createdAt:o.createdAt.toISOString(),updatedAt:o.updatedAt.toISOString()}))} categories={categories.map(c=>({id:c.id,name:c.name,code:c.code,sortOrder:c.sortOrder}))}/>}
