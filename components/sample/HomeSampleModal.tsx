'use client';
import SampleTeamCenter from '@/components/SampleTeamCenter';
import type { CurrentUserDTO } from '@/types';
import '@/app/sample-team-workbench.css';
import '@/app/sample-plan-schedule.css';
export default function HomeSampleModal({ user, taskId, queue, onClose }: { user: CurrentUserDTO; taskId: string; queue: string[]; onClose: () => void }) {
  return <SampleTeamCenter user={user} mode="planning" modalContext={{ taskId, queue, onClose }}/>;
}
