import {redirect} from 'next/navigation';
import {currentUser} from '@/lib/auth';
import LoginForm from '@/components/LoginForm';
export default async function Login(){if(await currentUser())redirect('/dashboard'); return <LoginForm/>}
