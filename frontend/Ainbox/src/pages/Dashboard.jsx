import { useSession } from '../hooks/useSession';
import LogoutButton from '../components/appComponents/LogoutButton';

export default function Dashboard() {
  const { user, terms } = useSession();
  return (
    <div className="min-h-screen w-full bg-stone-950 text-slate-100">
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <div className="flex items-center gap-3">
            <div className="text-sm text-slate-400 hidden sm:block">Terms: {terms?.version} {terms?.acceptedAt ? 'accepted' : 'pending'}</div>
            <LogoutButton />
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="text-slate-300 mb-2">Welcome{user?.name ? `, ${user.name}` : ''}.</div>
          <div className="text-slate-400">Start by opening your inbox or connecting an account.</div>
        </div>
      </div>
    </div>
  );
}
